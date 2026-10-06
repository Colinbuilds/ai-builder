import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { payTotals, type SovLine } from "@/lib/billing/payapps";
import { appName } from "@/lib/company-profile";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default async function PayApps() {
  await requireUser();
  const cs = await prisma.payContract.findMany({ include: { apps: { orderBy: { number: "desc" }, take: 1 } }, orderBy: [{ superName: "asc" }, { project: "asc" }] });
  const rows = cs.map((c) => {
    const lines = (c.apps[0]?.lines as SovLine[] | undefined) ?? (c.lines as SovLine[]);
    return { c, T: payTotals(lines, c.retainagePct ?? 0), last: c.apps[0] ?? null };
  });
  const open = rows.filter((r) => r.T.balance > 0.5);
  const done = rows.filter((r) => r.T.balance <= 0.5);
  const Table = ({ list }: { list: typeof rows }) => (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5">Project / GC</th>
            <th className="px-2 py-1.5">Super</th>
            <th className="px-2 py-1.5 text-right">Contract</th>
            <th className="px-2 py-1.5 text-right">Billed to date</th>
            <th className="px-2 py-1.5 text-right">%</th>
            <th className="px-2 py-1.5 text-right">Left to bill</th>
            <th className="px-2 py-1.5">Last application</th>
            <th className="px-2 py-1.5">Submit through</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {list.map(({ c, T, last }) => (
            <tr key={c.id}>
              <td className="px-2 py-1.5">
                <Link href={`/billing/pay-apps/${c.id}`} className="font-medium text-btr-link hover:underline">
                  {c.project}
                </Link>
                <div className="text-xs text-muted-foreground">{c.gc}</div>
              </td>
              <td className="px-2 py-1.5 text-xs">{c.superName}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{usd(T.scheduled)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{usd(T.completed)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{Math.round(T.pct * 100)}%</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{usd(T.balance)}</td>
              <td className="px-2 py-1.5 text-xs">{last ? `#${last.number} · ${last.status.toLowerCase()} · ${last.periodTo.toLocaleDateString("en-US")}` : c.retainagePct == null ? <span className="text-amber-700">set retainage</span> : `none yet in ${appName()}`}</td>
              <td className="max-w-[16rem] truncate px-2 py-1.5 text-xs" title={c.submitVia ?? ""}>
                {c.submitVia}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Pay applications (AIA)</h1>
        <p className="text-sm text-muted-foreground">
          Every commercial contract and its schedule of values, from the Commercial schedule&apos;s AIAs tab. Start the month&apos;s application, enter this period and stored materials,
          then print the G702 + G703.
        </p>
      </div>
      <section className="flex flex-col gap-1.5">
        <h2 className="font-semibold">Still billing ({open.length})</h2>
        <Table list={open} />
      </section>
      {done.length > 0 && (
        <details>
          <summary className="cursor-pointer font-semibold">Fully billed ({done.length})</summary>
          <div className="mt-2">
            <Table list={done} />
          </div>
        </details>
      )}
    </div>
  );
}
