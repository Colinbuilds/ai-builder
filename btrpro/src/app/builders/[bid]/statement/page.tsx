import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { builderStatement, type StatementRow } from "@/lib/builders/statement";
import { companyName } from "@/lib/company-profile";
import { PrintButton } from "@/components/ui/print-button";
import { formatUsd } from "@/lib/utils";

const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const day = (d: Date | null) => (d && d.getTime() ? d.toLocaleDateString("en-US", { timeZone: "UTC", month: "numeric", day: "numeric", year: "2-digit" }) : "");

export default async function StatementPage({ params, searchParams }: { params: Promise<{ bid: string }>; searchParams: Promise<{ m?: string }> }) {
  await requireUser(["ADMIN", "OFFICE", "ESTIMATOR"]);
  const { bid } = await params;
  const { m } = await searchParams;
  const b = await prisma.company.findUnique({ where: { id: bid }, select: { type: true } });
  if (!b || b.type !== "BUILDER") notFound();
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : ym(new Date());
  const s = await builderStatement(bid, month);
  const [y, mo] = month.split("-").map(Number);
  const prev = ym(new Date(Date.UTC(y, mo - 2, 1)));
  const next = ym(new Date(Date.UTC(y, mo, 1)));
  const title = s.from.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });

  const table = (rows: StatementRow[], cols: "billed" | "paid" | "open") =>
    rows.length === 0 ? (
      <p className="text-sm text-muted-foreground">None.</p>
    ) : (
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-1.5">Address</th>
            <th className="py-1.5">What</th>
            <th className="py-1.5">Invoice</th>
            <th className="py-1.5">Billed</th>
            {cols === "paid" && <th className="py-1.5">Paid</th>}
            {cols === "open" && <th className="py-1.5 text-right">Days</th>}
            <th className="py-1.5 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b last:border-0">
              <td className="py-1.5 pr-2">
                <Link href={r.href} className="hover:underline print:no-underline">
                  {r.where}
                </Link>
              </td>
              <td className="py-1.5 pr-2 text-muted-foreground">{r.what}</td>
              <td className="py-1.5 pr-2">{r.ref ?? ""}</td>
              <td className="py-1.5 pr-2 tabular-nums">{day(r.billedOn)}</td>
              {cols === "paid" && <td className="py-1.5 pr-2 tabular-nums">{day(r.paidOn)}</td>}
              {cols === "open" && <td className="py-1.5 pr-2 text-right tabular-nums">{r.billedOn ? Math.floor((s.to.getTime() - r.billedOn.getTime()) / 86_400_000) : "?"}</td>}
              <td className="py-1.5 text-right tabular-nums">{formatUsd(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={`/builders/${bid}`} className="text-sm text-muted-foreground">
          ← {s.company.name}
        </Link>
        <div className="flex items-center gap-2 text-sm">
          <Link href={`?m=${prev}`} className="rounded-md border px-3 py-1.5 hover:bg-muted">
            ← {prev}
          </Link>
          <Link href={`?m=${next}`} className="rounded-md border px-3 py-1.5 hover:bg-muted">
            {next} →
          </Link>
          <a href={`/api/builders/${bid}/statement?m=${month}`} className="rounded-md border px-3 py-1.5 hover:bg-muted">
            Download (Excel)
          </a>
          <PrintButton />
        </div>
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{companyName()}</p>
        <h1 className="text-2xl font-semibold">
          Statement — {s.company.name} — {title}
        </h1>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          [`Billed in ${title.split(" ")[0]}`, s.totals.billed],
          [`Paid in ${title.split(" ")[0]}`, s.totals.paid],
          ["Billed, no payment recorded", s.totals.open],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-lg border px-4 py-3">
            <div className="text-xs text-muted-foreground">{k}</div>
            <div className="text-xl font-semibold tabular-nums">{formatUsd(v as number)}</div>
          </div>
        ))}
      </div>
      {s.totals.open > 0 && (
        <div className="grid grid-cols-5 gap-2 text-center text-sm">
          {Object.entries(s.aging).map(([k, v]) => (
            <div key={k} className={`rounded-md border px-2 py-1.5 ${k === "90+" && v > 0 ? "border-red-300 text-red-800 dark:text-red-300" : ""}`}>
              <div className="text-xs text-muted-foreground">{k === "no date" ? "billed, no date" : `${k} days`}</div>
              <div className="font-medium tabular-nums">{formatUsd(v)}</div>
            </div>
          ))}
        </div>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Billed, no payment recorded in BTRpro ({s.open.length})</h2>
        <p className="text-xs text-muted-foreground print:hidden">Schedule lines count as paid once “Paid” is marked on the line (Production → the line → Paid); invoices once the payment is recorded. Payments kept only in QuickBooks don&apos;t show here — so older lines may already be paid.</p>
        {table(s.open, "open")}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Billed in {title} ({s.billed.length})</h2>
        {table(s.billed, "billed")}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Paid in {title} ({s.paid.length})</h2>
        {table(s.paid, "paid")}
      </section>
      {s.scheduleNames.length > 1 && <p className="text-xs text-muted-foreground print:hidden">From the schedule as: {s.scheduleNames.join(", ")}.</p>}
    </div>
  );
}
