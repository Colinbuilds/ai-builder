import { STAFF_ROLES } from "@/lib/roles";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { aiConfigured } from "@/lib/ai/claude";
import { ScanReceiptForm } from "@/components/receipts/scan-form";
import { Badge } from "@/components/ui/badge";
import { receiptsAddress } from "@/lib/receipts/inbox";
import { AutoRefresh } from "@/components/receipts/auto-refresh";

export default async function Receipts() {
  await requireUser(STAFF_ROLES);
  const scans = await prisma.receiptScan.findMany({ where: { bill: null }, include: { project: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 50 });
  const inbox = receiptsAddress();
  const label = (s: (typeof scans)[number]): [string, "green" | "red" | "amber" | "outline" | "blue"] =>
    s.status === "READING"
      ? ["reading…", "outline"]
      : s.status === "FAILED"
        ? ["couldn't read", "red"]
        : s.status === "FILED"
          ? s.outcome === "CHANGE_ORDER"
            ? ["change order", "blue"]
            : s.outcome === "INVOICE"
              ? ["invoice", "green"]
              : ["job cost", "outline"]
          : ["needs review", "amber"];
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      {scans.some((s) => s.status === "READING") && <AutoRefresh every={5000} />}
      <div>
        <h1 className="text-2xl font-semibold">Receipts</h1>
        <p className="text-sm text-muted-foreground">
          {inbox ? (
            <>
              Email receipts to <span className="font-mono font-medium text-foreground">{inbox}</span> from your BTR email (or a crew login email), or photograph one here.{" "}
            </>
          ) : null}
          Photograph an ABC (or any supplier) receipt. BTRpro reads it, finds the job from the PO, ship-to address or job name, lists every item, and checks each price against our price
          sheets — the builder&apos;s own pricing on builder jobs. Then file it to the job&apos;s material costs.
        </p>
      </div>
      {aiConfigured() ? <ScanReceiptForm /> : <p className="rounded-lg border border-btr-line p-4 text-sm">Reading receipts needs BTRbot turned on (ANTHROPIC_API_KEY on the server).</p>}
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Recent receipts</h2>
        {scans.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
        <ul className="divide-y rounded-lg border border-btr-line">
          {scans.map((s) => (
            <li key={s.id}>
              <Link href={`/receipts/${s.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/50">
                <span className="w-28 text-muted-foreground tabular-nums">{s.createdAt.toLocaleDateString("en-US", { timeZone: "America/Chicago" })}</span>
                <span className="flex-1">
                  {s.vendor ?? "Receipt"}
                  {s.invoiceNo ? ` · ${s.invoiceNo}` : ""}
                  {s.project && <span className="text-muted-foreground"> · {s.project.name}</span>}
                  <span className="block text-xs text-muted-foreground">
                    {s.source === "EMAIL" ? "Emailed" : "Uploaded"} by {s.employee ?? "staff"}
                    {s.subject ? ` · ${s.subject}` : ""}
                  </span>
                </span>
                <Badge variant={label(s)[1]}>{label(s)[0]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
