import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { activeBooks, housesPerYear } from "@/lib/builders/planbook";
import { auditRows, moneyFindings } from "@/lib/builders/plans";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatUsd } from "@/lib/utils";

export default async function PlanAuditPage({ params }: { params: Promise<{ bid: string }> }) {
  await requireUser(STAFF_ROLES);
  const { bid } = await params;
  const b = await prisma.company.findUnique({ where: { id: bid }, select: { id: true, name: true, type: true } });
  if (!b || b.type !== "BUILDER") notFound();
  const books = await activeBooks(b.id);
  const houses = await housesPerYear(b.name);

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/builders/${b.id}/plans`} className="text-sm text-muted-foreground">
        ← {b.name} models
      </Link>
      <h1 className="text-2xl font-semibold">{b.name} — profit audit</h1>
      <p className="text-sm text-muted-foreground">
        From the plan book: sell − crew payout − materials (incl. tax) = BTR profit per house. {houses ? `${houses} ${b.name} houses on the schedule in the last 12 months — used for the per-year figures.` : `No ${b.name} houses on the schedule in the last 12 months, so per-year figures are blank.`}
      </p>
      {books.length === 0 && <p className="text-sm">Import a plan book first.</p>}
      {books.map((book) => {
        const m = moneyFindings(book.data, houses);
        const rows = auditRows(book.data).filter((r) => r.kind === "ELEVATION");
        const byPlan = new Map<string, typeof rows>();
        for (const r of rows) byPlan.set(r.plan, [...(byPlan.get(r.plan) ?? []), r]);
        return (
          <section key={book.id} className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">{book.label}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Profit per house (roof + gutters)", m.perHouse != null ? formatUsd(m.perHouse) : "—"],
                ["Roofing margin", m.roofMargin != null ? `${m.roofMargin}%` : "—"],
                ["Gutter margin", m.gutMargin != null ? `${m.gutMargin}%` : "—"],
                ["Average roof", m.avgSq ? `${m.avgSq} SQ` : "—"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">{k}</div>
                  <div className="text-xl font-semibold">{v}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <h3 className="font-semibold">Where we can make more money</h3>
              <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
                {m.findings.map((f) => (
                  <li key={f.title}>
                    <span className="font-medium">{f.title}</span>
                    {f.perHouse != null && (
                      <span className="text-muted-foreground">
                        {" "}
                        — {formatUsd(f.perHouse)}/house{f.perYear != null ? ` ≈ ${formatUsd(f.perYear)}/yr` : ""}
                      </span>
                    )}
                    <div className="text-muted-foreground">{f.detail}</div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="flex flex-col gap-2">
              <h3 className="font-semibold">Lowest-margin builds</h3>
              <Table>
                <THead>
                  <TR>
                    <TH>Model</TH>
                    <TH>Trade</TH>
                    <TH className="text-right">Sell</TH>
                    <TH className="text-right">Profit</TH>
                    <TH className="text-right">Margin</TH>
                  </TR>
                </THead>
                <TBody>
                  {m.lowest.map((r) => (
                    <TR key={`${r.plan}-${r.trade}-${r.label}`}>
                      <TD>
                        {r.plan} · Elev {r.label}
                      </TD>
                      <TD>{r.trade === "ROOFING" ? "Roofing" : "Gutters"}</TD>
                      <TD className="text-right">{formatUsd(r.sell)}</TD>
                      <TD className="text-right">{formatUsd(r.profit)}</TD>
                      <TD className="text-right">{r.marginPct}%</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            <div className="flex flex-col gap-2">
              <h3 className="font-semibold">Profit on every build (base elevation, 2-car, standard basement)</h3>
              <Table>
                <THead>
                  <TR>
                    <TH>Model</TH>
                    <TH>Elev</TH>
                    <TH className="text-right">SQ</TH>
                    <TH className="text-right">Roof sell</TH>
                    <TH className="text-right">Roof profit</TH>
                    <TH className="text-right">Gutter sell</TH>
                    <TH className="text-right">Gutter profit</TH>
                    <TH className="text-right">House profit</TH>
                    <TH className="text-right">Old roof sell</TH>
                  </TR>
                </THead>
                <TBody>
                  {[...byPlan].flatMap(([plan, list]) =>
                    [...new Set(list.map((r) => r.label))].map((e) => {
                      const roof = list.find((r) => r.label === e && r.trade === "ROOFING");
                      const gut = list.find((r) => r.label === e && r.trade === "GUTTERS");
                      return (
                        <TR key={`${plan}-${e}`}>
                          <TD>
                            <Link href={`/builders/${b.id}/plans/${encodeURIComponent(plan)}?book=${book.id}&e=${encodeURIComponent(e)}`} className="underline">
                              {plan}
                            </Link>
                          </TD>
                          <TD>{e}</TD>
                          <TD className="text-right">{roof?.squares != null ? Math.round(roof.squares * 100) / 100 : ""}</TD>
                          <TD className="text-right">{roof ? formatUsd(roof.sell) : ""}</TD>
                          <TD className="text-right">{roof ? `${formatUsd(roof.profit)} (${roof.marginPct}%)` : ""}</TD>
                          <TD className="text-right">{gut ? formatUsd(gut.sell) : ""}</TD>
                          <TD className="text-right">{gut ? `${formatUsd(gut.profit)} (${gut.marginPct}%)` : ""}</TD>
                          <TD className="text-right font-medium">{formatUsd((roof?.profit ?? 0) + (gut?.profit ?? 0))}</TD>
                          <TD className="text-right">{roof?.oldSell != null ? formatUsd(roof.oldSell) : ""}</TD>
                        </TR>
                      );
                    }),
                  )}
                </TBody>
              </Table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
