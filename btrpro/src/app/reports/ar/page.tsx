import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { arAging } from "@/lib/billing/service";
import { AGING_BUCKETS, INVOICE_KIND_LABEL } from "@/lib/billing/math";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const d = (x: Date) => x.toLocaleDateString("en-US", { timeZone: "UTC" });
const TONE: Record<string, "outline" | "blue" | "amber" | "red"> = {
  Current: "outline",
  "1–30": "blue",
  "31–60": "amber",
  "61–90": "red",
  "90+": "red",
};

export default async function ArReport({
  searchParams,
}: {
  searchParams: Promise<{ market?: string }>;
}) {
  await requireUser(["ADMIN", "OFFICE"]);
  const { market } = await searchParams;
  const ar = await arAging();
  const rows = ar.rows.filter((r) => !market || r.project.market === market);
  const totals: Record<string, number> = {};
  for (const r of rows) totals[r.bucket] = (totals[r.bucket] ?? 0) + r.balance;
  const total = rows.reduce((a, r) => a + r.balance, 0);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Accounts receivable</h1>
        <p className="text-sm text-muted-foreground">
          Sent invoices with a balance, by days past due. Retainage held
          isn&apos;t in these numbers until it&apos;s invoiced.
        </p>
      </div>
      <div className="flex gap-2 text-sm">
        {[
          ["", "All"],
          ["RESIDENTIAL", "Residential"],
          ["COMMERCIAL", "Commercial"],
        ].map(([v, l]) => (
          <Link
            key={v}
            href={v ? `/reports/ar?market=${v}` : "/reports/ar"}
            className={`rounded-md border px-2 py-1 ${(market ?? "") === v ? "bg-muted font-medium" : ""}`}
          >
            {l}
          </Link>
        ))}
      </div>
      <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {AGING_BUCKETS.map((b) => (
          <div key={b} className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">
              {b === "Current" ? "Not yet due" : `${b} days late`}
            </p>
            <p className="text-lg tabular-nums">{usd(totals[b] ?? 0)}</p>
          </div>
        ))}
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Total open</p>
          <p className="text-lg font-semibold tabular-nums">{usd(total)}</p>
        </div>
      </section>
      <Table>
        <THead>
          <TR>
            <TH>Invoice</TH>
            <TH>Job</TH>
            <TH>Bill to</TH>
            <TH>Due</TH>
            <TH>Age</TH>
            <TH className="text-right">Balance</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id}>
              <TD>
                <span className="font-mono text-xs">{r.number}</span>
                <span className="block text-xs text-muted-foreground">
                  {INVOICE_KIND_LABEL[r.kind]}
                </span>
              </TD>
              <TD>
                <Link
                  className="hover:underline"
                  href={`/projects/${r.project.id}/billing`}
                >
                  {r.project.name}
                </Link>
              </TD>
              <TD className="text-sm">
                {r.billTo ?? "—"}
                {r.billToEmail && (
                  <span className="block text-xs text-muted-foreground">
                    {r.billToEmail}
                  </span>
                )}
              </TD>
              <TD className="text-sm">{d(r.dueDate)}</TD>
              <TD>
                <Badge variant={TONE[r.bucket]}>
                  {r.bucket === "Current" ? "not due" : `${r.bucket} days`}
                </Badge>
              </TD>
              <TD className="text-right tabular-nums">{usd(r.balance)}</TD>
            </TR>
          ))}
          {rows.length === 0 && (
            <TR>
              <TD
                colSpan={6}
                className="py-6 text-center text-muted-foreground"
              >
                Nothing outstanding.
              </TD>
            </TR>
          )}
        </TBody>
      </Table>
    </div>
  );
}
