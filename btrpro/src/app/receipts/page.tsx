import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { aiConfigured } from "@/lib/ai/claude";
import { ScanReceiptForm } from "@/components/receipts/scan-form";
import { Badge } from "@/components/ui/badge";

export default async function Receipts() {
  await requireUser(["ADMIN", "ESTIMATOR"]);
  const scans = await prisma.receiptScan.findMany({ include: { project: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 50 });
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Scan a receipt</h1>
        <p className="text-sm text-muted-foreground">
          Photograph an ABC (or any supplier) receipt. BTRpro reads it, finds the job from the PO, ship-to address or job name, lists every item, and checks each price against our price
          sheets — the builder&apos;s own pricing on builder jobs. Then file it to the job&apos;s material costs.
        </p>
      </div>
      {aiConfigured() ? <ScanReceiptForm /> : <p className="rounded-lg border border-btr-line p-4 text-sm">Reading receipts needs AI turned on (ANTHROPIC_API_KEY on the server).</p>}
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
                </span>
                <Badge variant={s.status === "FILED" ? "green" : s.status === "FAILED" ? "red" : "outline"}>{s.status === "READ" ? "not filed" : s.status.toLowerCase()}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
