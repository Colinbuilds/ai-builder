// 13-week cash forecast: the bank balance rolled forward week by week. Money in is placed on the date it
// realistically clears (each customer's own payment habit, not the invoice due date); money out on its due
// date; anything past due lands in week 1. Payroll and overhead come from Settings; one-offs are added by hand.
import { prisma } from "@/lib/db";
import { round } from "@/lib/calc/core";
import { getSettings } from "@/lib/settings";
import { balanceDue } from "@/lib/billing/math";
import { payTotals, type SovLine } from "@/lib/billing/payapps";

const DAY = 86_400_000;
const r2 = (n: number) => round(n, 2);

export type CashLine = { date: Date; label: string; amount: number; kind: "AR" | "PAYAPP" | "BUILDER" | "BILLS" | "CREW" | "PAYROLL" | "OVERHEAD" | "OTHER"; href?: string };
export type Week = { start: Date; open: number; in: number; out: number; close: number; lines: CashLine[] };

export function mondayOf(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7;
  return new Date(x.getTime() - dow * DAY);
}

/** Pure roll-forward: puts each line in its week (anything before week 1 lands in week 1). */
export function rollForward(start: Date, opening: number, lines: CashLine[], weeks = 13): Week[] {
  const w0 = mondayOf(start);
  const out: Week[] = Array.from({ length: weeks }, (_, i) => ({ start: new Date(w0.getTime() + i * 7 * DAY), open: 0, in: 0, out: 0, close: 0, lines: [] }));
  for (const l of lines) {
    const i = Math.max(0, Math.floor((l.date.getTime() - w0.getTime()) / (7 * DAY)));
    if (i >= weeks) continue;
    out[i].lines.push(l);
  }
  let bal = opening;
  for (const w of out) {
    w.open = r2(bal);
    w.in = r2(w.lines.filter((l) => l.amount > 0).reduce((a, l) => a + l.amount, 0));
    w.out = r2(w.lines.filter((l) => l.amount < 0).reduce((a, l) => a + l.amount, 0));
    bal = r2(bal + w.in + w.out);
    w.close = bal;
    w.lines.sort((a, b) => a.date.getTime() - b.date.getTime());
  }
  return out;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export async function cashForecast(now = new Date()) {
  const s = await getSettings();
  const lines: CashLine[] = [];
  const horizon = new Date(mondayOf(now).getTime() + 13 * 7 * DAY);

  // ---- money in: open invoices, at each customer's usual days past due
  const [open, paidHistory] = await Promise.all([
    prisma.invoice.findMany({
      where: { status: { in: ["SENT", "PARTIAL"] } },
      select: { id: true, number: true, amountDue: true, dueDate: true, retainage: true, payments: { select: { amount: true } }, project: { select: { id: true, name: true, clientCompanyId: true } } },
    }),
    prisma.invoice.findMany({
      where: { status: "PAID", payments: { some: {} } },
      select: { dueDate: true, project: { select: { clientCompanyId: true } }, payments: { select: { date: true }, orderBy: { date: "desc" }, take: 1 } },
      take: 2000,
      orderBy: { dueDate: "desc" },
    }),
  ]);
  const lateBy = new Map<string, number[]>();
  for (const p of paidHistory) {
    const k = p.project.clientCompanyId ?? "_";
    const late = Math.max(0, (p.payments[0].date.getTime() - p.dueDate.getTime()) / DAY);
    lateBy.set(k, [...(lateBy.get(k) ?? []), late]);
  }
  const companyLate = avg([...lateBy.values()].flat()) ?? 0;
  for (const i of open) {
    const bal = balanceDue(i);
    if (bal <= 0.005) continue;
    const late = avg(lateBy.get(i.project.clientCompanyId ?? "_") ?? []) ?? companyLate;
    const date = new Date(Math.max(i.dueDate.getTime() + late * DAY, now.getTime()));
    lines.push({ date, label: `Invoice ${i.number} — ${i.project.name}${late >= 5 ? ` (usually ${Math.round(late)} days late)` : ""}`, amount: r2(bal), kind: "AR", href: `/projects/${i.project.id}/billing` });
  }

  // ---- money in: submitted AIA pay apps (this period less retainage), ~45 days after the period
  const apps = await prisma.payApp.findMany({ where: { status: "SUBMITTED" }, select: { number: true, periodTo: true, submittedAt: true, lines: true, retainagePct: true, contract: { select: { id: true, project: true } } } });
  for (const a of apps) {
    const t = payTotals(a.lines as SovLine[], a.retainagePct);
    const due = r2((t.thisPeriod + t.stored) * (1 - a.retainagePct / 100));
    if (due <= 0) continue;
    const base = a.submittedAt ?? a.periodTo;
    lines.push({ date: new Date(Math.max(base.getTime() + 45 * DAY, now.getTime())), label: `Pay app #${a.number} — ${a.contract.project}`, amount: due, kind: "PAYAPP", href: `/billing/pay-apps/${a.contract.id}` });
  }

  // ---- money in: residential work billed to builders, at their usual pace
  const [billedLines, paidLines] = await Promise.all([
    prisma.prodLine.findMany({ where: { billedAt: { not: null }, btrPaid: null, sell: { not: null } }, select: { builder: true, location: true, sell: true, billedAt: true } }),
    prisma.prodLine.findMany({ where: { billedAt: { not: null }, paidAt: { not: null } }, select: { builder: true, billedAt: true, paidAt: true }, take: 2000, orderBy: { paidAt: "desc" } }),
  ]);
  const builderDays = new Map<string, number[]>();
  for (const l of paidLines) builderDays.set(l.builder ?? "_", [...(builderDays.get(l.builder ?? "_") ?? []), (l.paidAt!.getTime() - l.billedAt!.getTime()) / DAY]);
  for (const l of billedLines) {
    const days = avg(builderDays.get(l.builder ?? "_") ?? []) ?? 30;
    lines.push({ date: new Date(Math.max(l.billedAt!.getTime() + days * DAY, now.getTime())), label: `${l.builder ?? "Builder"} — ${l.location ?? ""}`, amount: r2(l.sell!), kind: "BUILDER", href: "/production?v=billing" });
  }

  // ---- money out: supplier bills by due date (past due → this week)
  const bills = await prisma.supplierBill.findMany({ where: { status: { in: ["READY", "APPROVED", "NEEDS_LOOK"] }, total: { not: null } }, select: { id: true, vendor: true, invoiceNumber: true, total: true, dueDate: true, invoiceDate: true } });
  for (const b of bills) {
    const due = b.dueDate ?? (b.invoiceDate ? new Date(b.invoiceDate.getTime() + (s.billNetDays ?? 30) * DAY) : now);
    lines.push({ date: due, label: `${b.vendor} bill ${b.invoiceNumber ?? ""}`.trim(), amount: -r2(b.total!), kind: "BILLS", href: `/bills/${b.id}` });
  }

  // ---- money out: crews to pay (completed, not yet paid) and crew invoices waiting
  const [toPay, crewInv] = await Promise.all([
    prisma.prodLine.findMany({ where: { completed: { not: null }, approved: null, board: { not: "COMPLETED" }, payout: { not: null } }, select: { crew: true, location: true, project: true, payout: true, paidToDate: true } }),
    prisma.crewInvoice.findMany({ where: { status: { in: ["SUBMITTED", "APPROVED"] } }, select: { amount: true, invoiceDate: true, crew: { select: { name: true } }, project: { select: { name: true } } } }),
  ]);
  for (const l of toPay) {
    const amt = r2((l.payout ?? 0) - (l.paidToDate ?? 0));
    if (amt > 0) lines.push({ date: now, label: `Crew pay — ${l.crew ?? "crew"}, ${l.location ?? l.project ?? ""}`, amount: -amt, kind: "CREW", href: "/production?v=billing" });
  }
  for (const c of crewInv) lines.push({ date: new Date(Math.max(c.invoiceDate.getTime() + 7 * DAY, now.getTime())), label: `Crew invoice — ${c.crew.name}, ${c.project.name}`, amount: -r2(c.amount), kind: "CREW", href: "/crews/invoices" });

  // ---- recurring: payroll weekly (Fridays), overhead on the 1st
  const w0 = mondayOf(now);
  for (let i = 0; i < 13; i++) {
    if (s.weeklyPayroll) lines.push({ date: new Date(w0.getTime() + (i * 7 + 4) * DAY), label: "Payroll", amount: -s.weeklyPayroll, kind: "PAYROLL" });
  }
  if (s.monthlyOverhead) {
    for (let m = 0; m < 4; m++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + m + (m === 0 && now.getUTCDate() > 1 ? 1 : 0), 1));
      if (d < horizon) lines.push({ date: d, label: "Overhead (rent, insurance, trucks…)", amount: -s.monthlyOverhead, kind: "OVERHEAD" });
    }
  }

  // ---- one-offs entered by hand
  const items = await prisma.cashItem.findMany({ where: { date: { lt: horizon } }, orderBy: { date: "asc" } });
  for (const c of items) lines.push({ date: c.date, label: c.label, amount: c.amount, kind: "OTHER" });

  // retainage held on invoices (not forecast: it moves with closeout, not progress)
  const retainageHeld = r2(open.reduce((a, i) => a + (i.retainage ?? 0), 0));

  const weeks = rollForward(now, s.cashOnHand ?? 0, lines);
  const low = weeks.reduce((m, w) => (w.close < m.close ? w : m), weeks[0]);
  return {
    weeks,
    opening: s.cashOnHand,
    asOf: s.cashAsOf,
    floor: s.cashFloor,
    low,
    belowFloor: s.cashFloor != null ? weeks.filter((w) => w.close < s.cashFloor!) : [],
    retainageHeld,
    missing: [s.cashOnHand == null && "today's bank balance", s.weeklyPayroll == null && "weekly payroll", s.monthlyOverhead == null && "monthly overhead"].filter(Boolean) as string[],
    items,
  };
}

export async function addCashItem(input: { date: Date; label: string; amount: number }, actor: { name: string }) {
  if (!input.label.trim()) throw new Error("Describe the item.");
  if (!Number.isFinite(input.amount) || input.amount === 0) throw new Error("Enter an amount (negative for money out).");
  return prisma.cashItem.create({ data: { ...input, label: input.label.trim(), createdBy: actor.name } });
}
