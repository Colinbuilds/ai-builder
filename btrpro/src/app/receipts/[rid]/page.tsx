import { STAFF_ROLES } from "@/lib/roles";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { cropOf, loadReceipt, type Saved } from "@/lib/receipts/service";
import { ReceiptPhotos } from "@/components/receipts/photo-tools";
import { receiptToBillAction } from "@/app/bills/actions";
import { LinePrices } from "@/components/receipts/line-prices";
import { getSettings } from "@/lib/settings";
import { qboConnected } from "@/lib/integrations/quickbooks";
import { canSeeCosts } from "@/lib/costing/service";
import { isSoldOrLater, type Stage } from "@/lib/projects/workflow";
import { BTR } from "@/lib/company";
import { ReceiptReview } from "@/components/receipts/review";
import { AutoRefresh } from "@/components/receipts/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";

const usd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const STATUS: Record<string, [string, "green" | "red" | "amber" | "outline" | "blue"]> = {
  OK: ["matches sheet", "green"],
  OVER: ["over sheet", "red"],
  UNDER: ["under sheet", "blue"],
  NO_ITEM_NUMBER: ["no item #", "amber"],
  NOT_ON_SHEETS: ["not on sheets", "amber"],
  NOT_ON_BUILDER: ["not on builder sheet", "amber"],
  UOM: ["unit differs", "amber"],
  CALL: ["CALL item", "amber"],
  NO_PRICE: ["no price", "amber"],
};
const OUTCOME: Record<string, string> = { COST_ONLY: "Filed to job costs", CHANGE_ORDER: "Change order drafted", INVOICE: "Invoice drafted" };

export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ rid: string }>; searchParams: Promise<{ job?: string }> }) {
  const user = await requireUser(STAFF_ROLES);
  const { rid } = await params;
  const { job } = await searchParams;
  const scan = await prisma.receiptScan.findUnique({ where: { id: rid }, include: { bill: { select: { id: true } } } });
  if (!scan) notFound();
  if (scan.bill) redirect(`/bills/${scan.bill.id}`);
  const files = scan.files as Saved[];
  const pagesInfo = files.map((f, i) => ({ index: i, pdf: f.type === "application/pdf", crop: cropOf(f), manual: f.crop != null, rotate: f.rotate ?? 0 }));
  const version = encodeURIComponent(JSON.stringify(files.map((f) => [f.crop ?? null, f.rotate ?? 0, f.auto ? 1 : 0])).slice(0, 300));
  const photos = (
    <div className="flex flex-col gap-2">
      <ReceiptPhotos rid={rid} pages={pagesInfo} version={version} canEdit={scan.status !== "FILED"} />
      {(scan.subject || scan.message) && (
        <div className="rounded-md bg-muted/60 p-2 text-xs">
          {scan.subject && (
            <p>
              <span className="font-medium">Subject:</span> {scan.subject}
            </p>
          )}
          {scan.message && (
            <p className="whitespace-pre-wrap">
              <span className="font-medium">{scan.source === "EMAIL" ? "Message" : "Note"}:</span> {scan.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
  const head = (
    <div className="flex flex-col gap-1">
      <Link href="/receipts" className="text-sm text-muted-foreground">
        ← Receipts
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">
          {scan.vendor ?? "Receipt"}
          {scan.invoiceNo ? ` · ${scan.invoiceNo}` : ""}
        </h1>
        {scan.outcome ? <Badge variant="green">{OUTCOME[scan.outcome]}</Badge> : null}
      </div>
      <p className="text-sm text-muted-foreground">
        {scan.source === "EMAIL" ? "Emailed" : "Uploaded"} by {scan.employee ?? "staff"} ·{" "}
        {scan.createdAt.toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" })}
      </p>
      {scan.status === "READ" && (
        <form action={receiptToBillAction}>
          <input type="hidden" name="scanId" value={scan.id} />
          <button className="text-sm text-btr-link hover:underline">On-account invoice we pay later? Move it to Supplier bills →</button>
        </form>
      )}
    </div>
  );

  const d = await loadReceipt(rid, job || null);
  if (!d)
    return (
      <div className="flex flex-col gap-4">
        {scan.status === "READING" && <AutoRefresh />}
        {head}
        <div className="grid gap-4 md:grid-cols-[320px_minmax(0,1fr)]">
          {photos}
          <p className="rounded-lg border border-btr-line p-4 text-sm">
            {scan.status === "READING"
              ? "Reading the receipt… this page updates on its own."
              : `Couldn't read this receipt${scan.error ? `: ${scan.error}` : "."} Retake the photo flat and in good light, or enter it by hand on the job's costs.`}
          </p>
        </div>
      </div>
    );

  const { receipt: r } = d;
  const [settings, qbo, jobs] = await Promise.all([
    getSettings(),
    qboConnected(),
    prisma.project.findMany({ where: { status: { notIn: ["LOST"] } }, select: { id: true, name: true, address: true }, orderBy: { updatedAt: "desc" }, take: 400 }),
  ]);
  const project = d.project;
  const access = project ? await prisma.project.findUnique({ where: { id: project.id }, select: { estimatorId: true, salespersonId: true } }) : null;
  const filed = scan.status === "FILED";
  const confident = !!d.match && d.projectId === d.match.projectId;
  const counts = d.lines.reduce<Record<string, number>>((a, l) => ((a[l.check.status] = (a[l.check.status] ?? 0) + 1), a), {});

  const ticket = r.documentType === "DELIVERY_TICKET";
  const unpriced = d.lines.map((l, i) => ({ i, l })).filter(({ l }) => l.amount == null || l.priced === "ENTERED");
  return (
    <div className="flex flex-col gap-5">
      {head}
      {ticket && (
        <p className="rounded-lg border border-btr-line bg-btr-blue-soft p-3 text-sm">
          <span className="font-semibold">Delivery ticket — no prices printed.</span> Lines are priced from our sheets{d.scope.builderName ? ` (${d.scope.builderName}'s pricing)` : ""} where the item # and unit match; type a price for the rest. Approving records the delivery
          on the job (and its material order, when the PO matches) but files no cost — ABC&apos;s invoice brings the real cost.
        </p>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,1.3fr)]">
        {photos}

        <div className="flex flex-col gap-4">
          <section className="rounded-lg border border-btr-line bg-background p-4 text-sm">
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">What it read</h2>
            <dl className="grid grid-cols-[6rem_1fr] gap-y-1">
              {[
                ["Employee", scan.employee],
                ["Job name", r.jobName ?? r.poNumber],
                ["Address", r.shipToAddress],
                ["Vendor", r.vendor],
                ["Date", r.date],
                ["Invoice #", r.invoiceNumber],
                ["PO", r.poNumber],
              ].map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className={v ? "" : "text-muted-foreground"}>{v ?? "—"}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-lg border border-btr-line bg-background p-4 text-sm">
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Job folder</h2>
            {project ? (
              <div className={`rounded-md p-3 ${confident || filed || job ? "bg-btr-blue-soft" : "bg-amber-50 dark:bg-amber-950"}`}>
                <Link href={`/projects/${project.id}`} className="font-semibold hover:underline">
                  {project.name}
                </Link>
                {project.address && <div className="text-xs">{project.address}</div>}
                <div className="mt-1 text-xs text-muted-foreground">
                  {filed ? "Filed in this job." : confident ? `Matched ${d.match!.score}% · ${d.match!.by}` : "Picked by hand"}
                </div>
              </div>
            ) : (
              <div className="rounded-md bg-amber-50 p-3 dark:bg-amber-950">
                <div className="font-semibold">Not sure which job</div>
                <div className="text-xs">Held for you to pick. {d.candidates.length ? "Closest matches:" : "Nothing matched the PO, address, job name or note."}</div>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {d.candidates.map((c) => (
                    <li key={c.projectId} className="flex justify-between gap-2 text-xs">
                      <Link href={`/receipts/${rid}?job=${c.projectId}`} className="text-btr-link underline">
                        {c.name}
                      </Link>
                      <span className="tabular-nums">{c.score}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!filed && (
              <form method="get" className="mt-2 flex flex-col gap-2">
                <Select name="job" defaultValue={d.projectId ?? ""} className="w-full">
                  <option value="">— pick the job —</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.name}
                      {j.address ? ` · ${j.address}` : ""}
                    </option>
                  ))}
                </Select>
                <Button size="sm" variant="outline" className="self-start">
                  Use this job
                </Button>
              </form>
            )}
          </section>
        </div>

        <ReceiptReview
          id={rid}
          vendor={r.vendor ?? "Supplier"}
          date={r.date}
          invoiceNumber={r.invoiceNumber}
          employee={scan.employee}
          lines={d.lines.map((l) => ({ itemNumber: l.itemNumber, description: l.description, quantity: l.quantity, uom: l.uom, amount: l.amount }))}
          ticket={ticket}
          tax={r.tax}
          defaultMarkup={d.defaultMarkup}
          lineMarkup={(scan.lineMarkup as Record<string, number> | null) ?? {}}
          reason={scan.message}
          project={project ? { id: project.id, name: project.name, address: project.address, sold: isSoldOrLater(project.status as Stage), contractNow: d.contractNow } : null}
          company={{ name: BTR.name, address: BTR.address }}
          qbo={{ connected: qbo, itemSet: !!settings.qboItemId, expenseSet: !!(settings.qboExpenseAccountId && settings.qboPaymentAccountId) }}
          filed={filed ? { outcome: scan.outcome, qboStatus: scan.qboStatus } : null}
          canApprove={!project || !access || canSeeCosts(user, access)}
        />
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Price check against our sheets</h2>
          <span className="flex flex-wrap gap-1.5 text-xs">
            {Object.entries(counts).map(([k, n]) => (
              <Badge key={k} variant={STATUS[k][1]}>
                {n} {STATUS[k][0]}
              </Badge>
            ))}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {d.scope.builderName ? `${d.scope.builderName}'s pricing${d.scope.fallback === "STANDARD" ? " (BTR standard where they have no price)" : ""}` : "BTR standard sheets"}. What ABC charged vs what our sheets say — separate from the markup above.
        </p>
        <div className="overflow-x-auto rounded-lg border border-btr-line">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Item #</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 font-medium">Unit</th>
                <th className="px-3 py-2 text-right font-medium">Charged</th>
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
                    {l.handwritten && <Badge variant="amber">handwritten</Badge>}
                    {l.orderedQuantity != null && l.quantity != null && l.orderedQuantity !== l.quantity && <span className="block text-xs font-medium">Ordered {l.orderedQuantity}, shipped {l.quantity}</span>}
                    {l.check.compared && l.check.compared.description.toLowerCase() !== l.description.toLowerCase() && <span className="block text-xs text-muted-foreground">Sheet: {l.check.compared.description}</span>}
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
                    {d.scope.builderName && l.check.standard && l.check.compared !== l.check.standard && l.check.standard.unitPrice != null && <span className="block text-[10px] text-muted-foreground">std {usd(l.check.standard.unitPrice)}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {l.amount == null ? <span className="font-semibold">MISSING</span> : usd(l.amount)}
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
        {!filed && unpriced.length > 0 && (
          <LinePrices
            id={rid}
            lines={unpriced.map(({ i, l }) => ({ index: i, label: `${l.itemNumber ? `${l.itemNumber} · ` : ""}${l.description}`, qty: l.quantity, uom: l.uom, price: l.priced === "ENTERED" && l.amount != null && l.quantity ? Math.round((l.amount / l.quantity) * 100) / 100 : null }))}
          />
        )}
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
              <dt className="font-semibold">ABC charged over our sheets</dt>
              <dd className="text-right font-semibold tabular-nums">{usd(d.overbilled)}</dd>
            </>
          )}
        </dl>
        {(ticket ? (d.totals?.flags ?? []).map((f) => (f.startsWith("Some lines have no amount") ? "Enter prices for the MISSING lines to bill the customer. Recording the delivery doesn't need them." : f)) : (d.totals?.flags ?? [])).map((f) => (
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
    </div>
  );
}
