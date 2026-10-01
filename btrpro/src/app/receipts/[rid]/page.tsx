import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadReceipt } from "@/lib/receipts/service";
import { FileReceiptForm } from "@/components/receipts/scan-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";

const usd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const STATUS: Record<string, [string, "green" | "red" | "amber" | "outline" | "blue"]> = {
  OK: ["matches", "green"],
  OVER: ["over sheet", "red"],
  UNDER: ["under sheet", "blue"],
  NO_ITEM_NUMBER: ["no item #", "amber"],
  NOT_ON_SHEETS: ["not on sheets", "amber"],
  NOT_ON_BUILDER: ["not on builder sheet", "amber"],
  UOM: ["unit differs", "amber"],
  CALL: ["CALL item", "amber"],
  NO_PRICE: ["no price", "amber"],
};

export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ rid: string }>; searchParams: Promise<{ job?: string }> }) {
  await requireUser(["ADMIN", "ESTIMATOR"]);
  const { rid } = await params;
  const { job } = await searchParams;
  const d = await loadReceipt(rid, job || null);
  if (!d) notFound();
  const { scan, receipt: r } = d;
  const files = scan.files as { url: string; type: string }[];
  const jobs = await prisma.project.findMany({ where: { status: { notIn: ["LOST"] } }, select: { id: true, name: true, address: true }, orderBy: { updatedAt: "desc" }, take: 400 });
  const chosen = d.projectId ? (jobs.find((j) => j.id === d.projectId) ?? (await prisma.project.findUnique({ where: { id: d.projectId }, select: { id: true, name: true, address: true } }))) : null;
  const filed = scan.status === "FILED";
  const counts = d.lines.reduce<Record<string, number>>((a, l) => ((a[l.check.status] = (a[l.check.status] ?? 0) + 1), a), {});

  return (
    <div className="flex flex-col gap-5">
      <Link href="/receipts" className="text-sm text-muted-foreground">
        ← Receipts
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{r?.vendor ?? "Receipt"}{r?.invoiceNumber ? ` · ${r.invoiceNumber}` : ""}</h1>
        <Badge variant={filed ? "green" : scan.status === "FAILED" ? "red" : "outline"}>{filed ? "filed" : scan.status === "FAILED" ? "couldn't read" : "not filed yet"}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          {!r ? (
            <p className="rounded-lg border border-btr-line p-4 text-sm">
              Couldn&apos;t read this receipt{scan.error ? `: ${scan.error}` : "."} Retake the photo flat and in good light, or enter it by hand on the job&apos;s costs.
            </p>
          ) : (
            <>
              <section className="grid gap-x-6 gap-y-1 rounded-lg border border-btr-line p-4 text-sm sm:grid-cols-2">
                {[
                  ["PO", r.poNumber],
                  ["Job name", r.jobName],
                  ["Ship to", [r.shipToName, r.shipToAddress].filter(Boolean).join(" · ") || null],
                  ["Date", r.date],
                  ["Order #", r.orderNumber],
                  ["Branch", r.branch],
                ].map(([k, v]) => (
                  <div key={k as string} className="flex gap-2">
                    <span className="w-20 shrink-0 font-medium">{k}</span>
                    <span className={v ? "" : "text-muted-foreground"}>{v ?? "not printed"}</span>
                  </div>
                ))}
              </section>

              <section className="flex flex-col gap-2 rounded-lg border border-btr-line p-4">
                <h2 className="font-semibold">Job</h2>
                {d.match && d.projectId === d.match.projectId ? (
                  <p className="text-sm">
                    Matched by {d.match.by}: <span className="font-medium">{chosen?.name}</span>
                    {chosen?.address && <span className="text-muted-foreground"> · {chosen.address}</span>}
                  </p>
                ) : chosen ? (
                  <p className="text-sm">
                    <span className="font-medium">{chosen.name}</span> {chosen.address && <span className="text-muted-foreground">· {chosen.address}</span>}
                  </p>
                ) : (
                  <p className="text-sm">No single job matched the PO, address or job name{d.candidates.length ? ". Possible jobs:" : ". Pick it below."}</p>
                )}
                {!chosen && d.candidates.length > 0 && (
                  <ul className="flex flex-col gap-1 text-sm">
                    {d.candidates.map((c) => (
                      <li key={c.projectId}>
                        <Link href={`/receipts/${rid}?job=${c.projectId}`} className="text-btr-link underline">
                          {c.name}
                        </Link>{" "}
                        <span className="text-muted-foreground">
                          ({c.by}){c.address ? ` · ${c.address}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {!filed && (
                  <form method="get" className="flex flex-wrap items-center gap-2">
                    <Select name="job" defaultValue={d.projectId ?? ""} className="max-w-md min-w-0 flex-1">
                      <option value="">— pick the job —</option>
                      {jobs.map((j) => (
                        <option key={j.id} value={j.id}>
                          {j.name}
                          {j.address ? ` · ${j.address}` : ""}
                        </option>
                      ))}
                    </Select>
                    <Button size="sm" variant="outline">
                      Use this job
                    </Button>
                  </form>
                )}
                <p className="text-xs text-muted-foreground">
                  Prices checked against {d.scope.builderName ? `${d.scope.builderName}'s pricing${d.scope.fallback === "STANDARD" ? " (BTR standard where they have no price)" : ""}` : "BTR standard sheets"}.
                </p>
              </section>

              <section className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-semibold">Items ({d.lines.length})</h2>
                  <span className="flex flex-wrap gap-1.5 text-xs">
                    {Object.entries(counts).map(([k, n]) => (
                      <Badge key={k} variant={STATUS[k][1]}>
                        {n} {STATUS[k][0]}
                      </Badge>
                    ))}
                  </span>
                </div>
                <div className="overflow-x-auto rounded-lg border border-btr-line">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-left text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Item #</th>
                        <th className="px-3 py-2 font-medium">Description</th>
                        <th className="px-3 py-2 text-right font-medium">Qty</th>
                        <th className="px-3 py-2 font-medium">Unit</th>
                        <th className="px-3 py-2 text-right font-medium">Billed</th>
                        <th className="px-3 py-2 text-right font-medium">Sheet</th>
                        <th className="px-3 py-2 text-right font-medium">Amount</th>
                        <th className="px-3 py-2 font-medium">Check</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.lines.map((l, i) => (
                        <tr key={i} className={`border-t align-top ${l.check.status === "OVER" ? "bg-red-50 dark:bg-red-950/40" : ""}`}>
                          <td className="px-3 py-2 font-mono text-xs">{l.itemNumber ?? "—"}</td>
                          <td className="px-3 py-2">
                            {l.description}
                            {l.check.compared && l.check.compared.description.toLowerCase() !== l.description.toLowerCase() && (
                              <span className="block text-xs text-muted-foreground">Sheet: {l.check.compared.description}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{l.quantity ?? "—"}</td>
                          <td className="px-3 py-2">{l.uom ?? "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{usd(l.unitPrice)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {l.check.compared ? (
                              <>
                                {l.check.compared.unitPrice == null ? "CALL" : usd(l.check.compared.unitPrice)}
                                <span className="block text-[10px] text-muted-foreground">
                                  {l.check.compared.builder ? "builder " : ""}
                                  {l.check.compared.code}/{l.check.compared.uom}
                                </span>
                              </>
                            ) : (
                              "—"
                            )}
                            {d.scope.builderName && l.check.standard && l.check.compared !== l.check.standard && l.check.standard.unitPrice != null && (
                              <span className="block text-[10px] text-muted-foreground">std {usd(l.check.standard.unitPrice)}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {usd(l.amount)}
                            {l.formula && <span className="block text-[10px] text-muted-foreground">{l.formula}</span>}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            <Badge variant={STATUS[l.check.status][1]}>{STATUS[l.check.status][0]}</Badge>
                            <span className="mt-1 block">{l.check.note}</span>
                            {l.mathFlag && <span className="mt-1 block font-medium">Math: {l.mathFlag}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <dl className="ml-auto grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm">
                  <dt>Lines add up to</dt>
                  <dd className="text-right tabular-nums">{usd(d.totals?.sum)}</dd>
                  <dt>Subtotal (printed)</dt>
                  <dd className="text-right tabular-nums">{usd(r.subtotal)}</dd>
                  <dt>Tax (printed)</dt>
                  <dd className="text-right tabular-nums">{usd(r.tax)}</dd>
                  <dt className="font-semibold">Total (printed)</dt>
                  <dd className="text-right font-semibold tabular-nums">{usd(r.total)}</dd>
                  {d.overbilled > 0 && (
                    <>
                      <dt className="font-semibold">Billed over the sheet</dt>
                      <dd className="text-right font-semibold tabular-nums">{usd(d.overbilled)}</dd>
                    </>
                  )}
                </dl>
                {d.totals?.flags.map((f) => (
                  <p key={f} className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm dark:border-amber-800 dark:bg-amber-950">
                    {f}
                  </p>
                ))}
                {r.notes.length > 0 && (
                  <div className="text-sm">
                    <span className="font-medium">Couldn&apos;t read clearly:</span>
                    <ul className="list-disc pl-5 text-muted-foreground">
                      {r.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          {r && (
            <section className="flex flex-col gap-2 rounded-lg border border-btr-line p-4">
              <h2 className="font-semibold">File it</h2>
              <p className="text-sm text-muted-foreground">
                Adds each line to {chosen ? <span className="font-medium text-foreground">{chosen.name}</span> : "the job"}&apos;s material costs with its sheet price, and the photos to the job&apos;s
                documents. A PO matching one of the job&apos;s material orders bills that order.
              </p>
              {filed ? (
                <p className="text-sm">
                  Filed {scan.filedAt?.toLocaleDateString("en-US", { timeZone: "America/Chicago" })}.{" "}
                  {scan.projectId && (
                    <Link className="text-btr-link underline" href={`/projects/${scan.projectId}/costs`}>
                      Job costs
                    </Link>
                  )}
                </p>
              ) : (
                <FileReceiptForm id={rid} projectId={d.projectId} disabled={d.projectId ? null : "Pick the job first."} />
              )}
            </section>
          )}
          <section className="flex flex-col gap-2">
            {files.map((f, i) =>
              f.type === "application/pdf" ? (
                <a key={i} href={`/api/receipts/${rid}/${i}`} target="_blank" className="text-sm text-btr-link underline">
                  Open PDF
                </a>
              ) : (
                <a key={i} href={`/api/receipts/${rid}/${i}`} target="_blank">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/receipts/${rid}/${i}`} alt={`Receipt photo ${i + 1}`} className="w-full rounded-md border border-btr-line" />
                </a>
              ),
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
