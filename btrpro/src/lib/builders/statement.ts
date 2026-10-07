// A builder's monthly statement: what was billed and paid that month, and everything still owed, house by house —
// for the builder's accounts payable and for the office. Two sources: production schedule lines (where most
// builder billing is tracked, often as text like "x 10/1/26") and invoices on jobs for the builder's account.
import { prisma } from "@/lib/db";
import { matchAccount } from "@/lib/import/schedule";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** "x 10/1/26", "Billed 10/01/2026 Jo", "9-10-26" → the date (noon UTC); null when there isn't one. */
export function dateIn(text: string | null | undefined): Date | null {
  const m = (text ?? "").match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const mo = Number(m[1]);
  const d = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, mo - 1, d, 12));
}

export type StatementRow = { key: string; where: string; what: string; amount: number; billedOn: Date | null; paidOn: Date | null; source: "SCHEDULE" | "INVOICE"; ref: string | null; href: string };

/** month = "YYYY-MM" */
export async function builderStatement(companyId: string, month: string) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { id: true, name: true, email: true, phone: true } });
  const [y, mo] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, mo - 1, 1));
  const to = new Date(Date.UTC(y, mo, 1));
  const inMonth = (d: Date | null) => !!d && d >= from && d < to;

  // schedule lines: the builder text often carries the subdivision ("DR Horton Westbrook Hills") — it belongs to
  // this account when the name matcher says so (the same rule the schedule import uses)
  const builders = await prisma.company.findMany({ where: { type: "BUILDER" }, select: { id: true, name: true, type: true } });
  const texts = await prisma.prodLine.groupBy({ by: ["builder"], where: { builder: { not: null }, billed: { not: null } } });
  const ours = texts.map((t) => t.builder!).filter((t) => matchAccount(t, builders).account?.id === company.id);
  const lines = ours.length
    ? await prisma.prodLine.findMany({ where: { builder: { in: ours }, billed: { not: null } }, select: { id: true, builder: true, location: true, model: true, type: true, sell: true, billed: true, billedAt: true, btrPaid: true, paidAt: true } })
    : [];
  const rows: StatementRow[] = lines.map((l) => ({
    key: `L${l.id}`,
    where: l.location ?? "",
    what: [l.builder !== company.name ? l.builder : null, l.model, l.type].filter(Boolean).join(" · "),
    amount: r2(l.sell ?? 0),
    billedOn: l.billedAt ?? dateIn(l.billed),
    paidOn: l.paidAt ?? (l.btrPaid ? (dateIn(l.btrPaid) ?? new Date(0)) : null),
    source: "SCHEDULE",
    ref: null,
    href: `/production/${l.id}`,
  }));

  // invoices on jobs billed to this builder
  const invoices = await prisma.invoice.findMany({
    where: { status: { notIn: ["DRAFT", "VOID"] }, project: { clientCompanyId: company.id } },
    select: { id: true, number: true, amountDue: true, issueDate: true, status: true, project: { select: { id: true, name: true, address: true } }, payments: { select: { amount: true, date: true }, orderBy: { date: "desc" } } },
  });
  for (const i of invoices) {
    const paid = r2(i.payments.reduce((a, p) => a + p.amount, 0));
    rows.push({
      key: `I${i.id}`,
      where: i.project.address ?? i.project.name,
      what: i.project.name,
      amount: r2(i.amountDue),
      billedOn: i.issueDate,
      paidOn: i.status === "PAID" || paid >= i.amountDue - 0.005 ? (i.payments[0]?.date ?? new Date(0)) : null,
      source: "INVOICE",
      ref: i.number,
      href: `/projects/${i.project.id}/billing`,
    });
  }

  const billed = rows.filter((r) => inMonth(r.billedOn)).sort((a, b) => a.billedOn!.getTime() - b.billedOn!.getTime());
  const paid = rows.filter((r) => inMonth(r.paidOn)).sort((a, b) => a.paidOn!.getTime() - b.paidOn!.getTime());
  // owed as of the end of the month: billed by then and not paid by then (a payment with no date counts as paid)
  // a line marked billed with no readable date still counts (oldest first; aged as "no date")
  const billedBy = (r: StatementRow) => (r.billedOn ? r.billedOn < to : r.source === "SCHEDULE");
  const open = rows
    .filter((r) => billedBy(r) && (!r.paidOn || (r.paidOn.getTime() > 0 && r.paidOn >= to)))
    .sort((a, b) => (a.billedOn?.getTime() ?? 0) - (b.billedOn?.getTime() ?? 0));
  const sum = (xs: StatementRow[]) => r2(xs.reduce((a, r) => a + r.amount, 0));
  const days = (r: StatementRow) => Math.floor((to.getTime() - r.billedOn!.getTime()) / 86_400_000);
  const aging = { "0–30": 0, "31–60": 0, "61–90": 0, "90+": 0, "no date": 0 };
  for (const r of open) {
    if (!r.billedOn) {
      aging["no date"] = r2(aging["no date"] + r.amount);
      continue;
    }
    const d = days(r);
    aging[d <= 30 ? "0–30" : d <= 60 ? "31–60" : d <= 90 ? "61–90" : "90+"] = r2(aging[d <= 30 ? "0–30" : d <= 60 ? "31–60" : d <= 90 ? "61–90" : "90+"] + r.amount);
  }
  return { company, month, from, to, billed, paid, open, totals: { billed: sum(billed), paid: sum(paid), open: sum(open) }, aging, scheduleNames: ours };
}

export function statementCsv(s: Awaited<ReturnType<typeof builderStatement>>) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const day = (d: Date | null) => (d && d.getTime() ? d.toISOString().slice(0, 10) : "");
  const out = [["Section", "Address", "What", "Ref", "Billed", "Paid", "Amount"].join(",")];
  for (const [sec, rows] of [["Billed this month", s.billed], ["Paid this month", s.paid], ["Billed, no payment recorded", s.open]] as const)
    for (const r of rows) out.push([sec, r.where, r.what, r.ref ?? "", day(r.billedOn), day(r.paidOn), r.amount.toFixed(2)].map((v) => esc(String(v))).join(","));
  return out.join("\n");
}
