import { round } from "@/lib/calc/core";

// Pure billing math (no database).

export type InvLine = { description: string; amount: number };
export const INVOICE_KIND_LABEL: Record<string, string> = {
  DEPOSIT: "Deposit",
  PROGRESS: "Progress",
  FINAL: "Final",
  CHANGE_ORDER: "Change order",
  RETAINAGE_RELEASE: "Retainage release",
  OTHER: "Other",
};
export const PAYMENT_METHODS: Record<string, string> = { CHECK: "Check", ACH: "ACH / bank transfer", CARD: "Card", CASH: "Cash", INSURANCE_CHECK: "Insurance check", OTHER: "Other" };

export function invoiceTotals(lines: InvLine[], retainagePct: number | null, kind: string) {
  for (const l of lines) {
    if (!l.description.trim()) throw new Error("Every invoice line needs a description.");
    if (!Number.isFinite(l.amount) || l.amount === 0) throw new Error(`"${l.description}" needs an amount.`);
  }
  if (!lines.length) throw new Error("Add at least one line.");
  const subtotal = round(lines.reduce((a, l) => a + l.amount, 0), 2);
  // retainage is withheld from progress/final billing, never from a deposit or a release of retainage itself
  const pct = kind === "PROGRESS" || kind === "FINAL" || kind === "CHANGE_ORDER" ? (retainagePct ?? 0) : 0;
  const retainage = round((subtotal * pct) / 100, 2);
  return { subtotal, retainagePct: pct || null, retainage, amountDue: round(subtotal - retainage, 2) };
}

type Inv = { kind: string; status: string; subtotal: number; retainage: number; amountDue: number; payments: { amount: number }[] };

/** Where the job stands: billed vs. contract, retainage, cash in. */
export function billingSummary(revenue: number | null, invoices: Inv[]) {
  const live = invoices.filter((i) => i.status !== "VOID" && i.status !== "DRAFT");
  const billedWork = round(live.filter((i) => i.kind !== "RETAINAGE_RELEASE").reduce((a, i) => a + i.subtotal, 0), 2);
  const retainageHeld = round(live.reduce((a, i) => a + i.retainage, 0) - live.filter((i) => i.kind === "RETAINAGE_RELEASE").reduce((a, i) => a + i.subtotal, 0), 2);
  const paid = round(live.reduce((a, i) => a + i.payments.reduce((b, p) => b + p.amount, 0), 0), 2);
  const invoicedDue = round(live.reduce((a, i) => a + i.amountDue, 0), 2);
  return {
    revenue,
    billedWork,
    unbilled: revenue == null ? null : round(revenue - billedWork, 2),
    retainageHeld,
    paid,
    openAR: round(invoicedDue - paid, 2),
    // what the customer still owes in total once everything is billed (includes retainage)
    remaining: revenue == null ? null : round(revenue - paid, 2),
  };
}

export const balanceDue = (i: { amountDue: number; payments: { amount: number }[] }) => round(i.amountDue - i.payments.reduce((a, p) => a + p.amount, 0), 2);

export function paymentStatus(amountDue: number, paid: number): "SENT" | "PARTIAL" | "PAID" {
  if (paid <= 0) return "SENT";
  return paid + 0.005 >= amountDue ? "PAID" : "PARTIAL";
}

export const AGING_BUCKETS = ["Current", "1–30", "31–60", "61–90", "90+"] as const;
export function agingBucket(dueDate: Date, asOf: Date): (typeof AGING_BUCKETS)[number] {
  const days = Math.floor((Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()) - Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate())) / 86_400_000);
  if (days <= 0) return "Current";
  if (days <= 30) return "1–30";
  if (days <= 60) return "31–60";
  if (days <= 90) return "61–90";
  return "90+";
}

/** Card surcharge on top of the payment, only when the company has set one (where permitted). */
export function cardSurcharge(amount: number, pct: number | null) {
  if (!pct) return { surcharge: 0, formula: null };
  const surcharge = round((amount * pct) / 100, 2);
  return { surcharge, formula: `${amount.toFixed(2)} × ${pct}% card surcharge = ${surcharge.toFixed(2)}` };
}
