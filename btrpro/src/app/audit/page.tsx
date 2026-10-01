import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { auditQueue, auditStats, ENTITY_LABEL } from "@/lib/audit";
import { cropOf, type Saved } from "@/lib/receipts/service";
import type { BillMatch } from "@/lib/bills/match";
import { ReceiptPhotos } from "@/components/receipts/photo-tools";
import { ReviewButtons } from "@/components/audit/review-buttons";
import { Panel, axLink } from "@/components/shell/panel";

const usd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const day = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" });
const DAY = 86_400_000;
const SCOPES: Record<string, [string, number | null]> = { week: ["This week", 7], month: ["This month", 31], all: ["Everything unreviewed", null] };

function riskTone(r: number) {
  return r >= 85 ? "bg-red-600" : r >= 60 ? "bg-amber-500" : "bg-btr-line";
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ scope?: string; at?: string; sample?: string }> }) {
  await requireOwner();
  const sp = await searchParams;
  const scope = SCOPES[sp.scope ?? "month"] ? (sp.scope ?? "month") : "month";
  const days = SCOPES[scope][1];
  const since = days ? new Date(Date.now() - days * DAY) : null;
  const sample = sp.sample === "10" ? 10 : null;
  const queue = await auditQueue({ since, sample });
  const at = Math.min(Math.max(0, Number(sp.at) || 0), Math.max(0, queue.length - 1));
  const cur = queue[at] ?? null;
  const stats = await auditStats(since ?? new Date(0));
  const qs = (o: Record<string, string | number | null>) => {
    const p = new URLSearchParams({ scope, ...(sample ? { sample: "10" } : {}) });
    for (const [k, v] of Object.entries(o)) if (v != null) p.set(k, String(v));
    return `/audit?${p}`;
  };

  // detail for the item on top
  let detail: React.ReactNode = null;
  if (cur?.entity === "SUPPLIER_BILL") {
    const bill = await prisma.supplierBill.findUnique({ where: { id: cur.id }, include: { scan: true } });
    if (bill) {
      const files = bill.scan.files as Saved[];
      const pages = files.map((f, i) => ({ index: i, pdf: f.type === "application/pdf", crop: cropOf(f), manual: f.crop != null, rotate: f.rotate ?? 0 }));
      const m = bill.match as BillMatch | null;
      const [history, job] = await Promise.all([
        prisma.auditLog.findMany({ where: { entity: "SupplierBill", entityId: bill.id }, include: { user: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
        bill.projectId ? prisma.project.findUnique({ where: { id: bill.projectId }, select: { name: true, contractAmount: true, costs: { select: { amount: true } } } }) : null,
      ]);
      const cost = job ? Math.round(job.costs.reduce((a, c) => a + c.amount, 0) * 100) / 100 : null;
      detail = (
        <div className="grid gap-4 lg:grid-cols-2">
          <ReceiptPhotos rid={bill.scanId} pages={pages} version="audit" canEdit={false} />
          <div className="flex flex-col gap-3 text-sm">
            <div>
              <div className="font-medium">Checks</div>
              {m?.lines.some((l) => l.flags.length) || m?.notes.length ? (
                <ul className="list-disc pl-5">
                  {m?.notes.map((n) => <li key={n}>{n}</li>)}
                  {m?.lines.filter((l) => l.flags.length).map((l) => <li key={l.index}>Line {l.index + 1}: {l.notes.join(" ")}</li>)}
                </ul>
              ) : (
                <p className="text-green-700">Matched PO, delivery and sheet prices.</p>
              )}
            </div>
            <div>
              <div className="font-medium">Who touched it</div>
              <ul className="text-muted-foreground">
                <li>Added {day(bill.createdAt)} by {bill.scan.employee ?? "staff"}</li>
                {history.map((h) => (
                  <li key={h.id}>
                    {h.action} by {h.user?.name ?? "system"} {day(h.createdAt)}
                    {(h.after as { note?: string } | null)?.note ? ` — “${(h.after as { note?: string }).note}”` : ""}
                  </li>
                ))}
              </ul>
            </div>
            {job && (
              <div>
                <div className="font-medium">Job impact — {job.name}</div>
                <p className="text-muted-foreground">
                  This bill {usd(bill.total)} · job costs to date {usd(cost)}
                  {job.contractAmount != null && cost != null ? ` · contract ${usd(job.contractAmount)} · margin so far ${Math.round(((job.contractAmount - cost) / job.contractAmount) * 1000) / 10}%` : ""}
                </p>
              </div>
            )}
          </div>
        </div>
      );
    }
  } else if (cur?.entity === "CREW_INVOICE") {
    const ci = await prisma.crewInvoice.findUnique({ where: { id: cur.id }, include: { crew: { select: { name: true } } } });
    if (ci)
      detail = (
        <div className="flex flex-col gap-2 text-sm">
          <p>{ci.description}</p>
          <p className="text-muted-foreground">
            Approved by {ci.reviewedBy ?? "—"} {ci.reviewedAt ? day(ci.reviewedAt) : ""}
            {ci.paidAt ? ` · paid ${day(ci.paidAt)}` : ""}
          </p>
          {ci.fileUrl && (
            <a href={`/api/crew/invoice/${ci.id}`} target="_blank" rel="noreferrer" className={axLink}>
              Open the crew&apos;s invoice file
            </a>
          )}
          <Link href={`/projects/${ci.projectId}/photos`} className={axLink}>
            See the job photos
          </Link>
        </div>
      );
  }

  return (
    <div className="flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Owner audit</h1>
          <p className="text-sm text-muted-foreground">
            Approved bills, crew pay, voids and change orders — riskiest first. ✓ marks it reviewed; ⚑ sends your question back to whoever approved it as a task.
          </p>
        </div>
        <div className="text-sm">
          {stats.approved > 0 ? (
            <span>
              Reviewed <b>{Math.min(100, Math.round((stats.reviews / stats.approved) * 100))}%</b> of {stats.approved} approved bills &amp; crew invoices ({SCOPES[scope][0].toLowerCase()})
            </span>
          ) : null}
        </div>
      </div>
      <nav className="flex flex-wrap items-center gap-1 text-sm">
        {Object.entries(SCOPES).map(([k, [label]]) => (
          <Link key={k} href={`/audit?scope=${k}${sample ? "&sample=10" : ""}`} className={`rounded-md border px-3 py-1 ${scope === k ? "border-btr-black bg-btr-black text-white" : "hover:bg-accent"}`}>
            {label}
          </Link>
        ))}
        <Link href={`/audit?scope=${scope}${sample ? "" : "&sample=10"}`} className={`rounded-md border px-3 py-1 ${sample ? "border-btr-black bg-btr-black text-white" : "hover:bg-accent"}`}>
          Random spot-check of 10
        </Link>
      </nav>

      {!cur ? (
        <p className="rounded-md bg-green-50 p-4 text-sm text-green-800 dark:bg-green-950/40 dark:text-green-300">Nothing left to review here.</p>
      ) : (
        <Panel
          title={
            <span className="flex flex-wrap items-center gap-2">
              <span className={`inline-block size-2.5 rounded-full ${riskTone(cur.risk)}`} />
              {ENTITY_LABEL[cur.entity]}: {cur.title}
              <span className="font-normal text-muted-foreground">
                · {cur.sub} · {usd(cur.amount)} · {day(cur.date)}
              </span>
            </span>
          }
          right={
            <span className="text-muted-foreground">
              {at + 1} of {queue.length} ·{" "}
              <Link href={cur.href} className={axLink}>
                open
              </Link>
            </span>
          }
        >
          <div className="flex flex-col gap-4">
            {cur.reasons.length > 0 && (
              <ul className="flex flex-wrap gap-2 text-sm">
                {cur.reasons.map((r) => (
                  <li key={r} className="rounded-md bg-amber-50 px-2 py-1 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    {r}
                  </li>
                ))}
              </ul>
            )}
            <ReviewButtons entity={cur.entity} id={cur.id} prevHref={at > 0 ? qs({ at: at - 1 }) : null} nextHref={at < queue.length - 1 ? qs({ at: at + 1 }) : null} />
            {detail}
          </div>
        </Panel>
      )}

      {queue.length > 1 && (
        <Panel title={`In the stack (${queue.length})`} bodyClass="p-0">
          <ul className="divide-y text-sm">
            {queue.map((q, i) => (
              <li key={`${q.entity}:${q.id}`} className={`flex flex-wrap items-center gap-2 px-4 py-2 ${i === at ? "bg-btr-blue-soft" : ""}`}>
                <span className={`inline-block size-2 rounded-full ${riskTone(q.risk)}`} />
                <Link href={qs({ at: i })} className={axLink}>
                  {ENTITY_LABEL[q.entity]}: {q.title}
                </Link>
                <span className="text-muted-foreground">· {q.sub}</span>
                <span className="ml-auto tabular-nums">{usd(q.amount)}</span>
                {q.reasons[0] && <span className="w-full pl-4 text-xs text-muted-foreground">{q.reasons.join(" · ")}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
