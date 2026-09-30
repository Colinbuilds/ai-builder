import { round } from "@/lib/calc/core";

// Pure scheduling / compliance / pay math (no database).

export const EVENT_KINDS: Record<string, string> = { INSTALL: "Install", TEAR_OFF: "Tear-off", INSPECTION: "Inspection", DUMPSTER: "Dumpster drop/swap", REPAIR: "Repair / service", OTHER: "Other" };

export const day = (d: Date) => d.toISOString().slice(0, 10);
export const atNoon = (ymd: string) => new Date(`${ymd}T12:00:00Z`);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

export type ComplianceItem = { label: string; date: Date | null; status: "OK" | "EXPIRING" | "EXPIRED" | "MISSING" };
export type Compliance = { status: ComplianceItem["status"]; items: ComplianceItem[] };

const RANK = { OK: 0, EXPIRING: 1, MISSING: 2, EXPIRED: 3 } as const;

/** Subs must carry a current COI and workers' comp; a license is checked when one is on file. In-house crews are covered by BTR. */
export function compliance(c: { kind: "CREW" | "SUB"; coiExpires: Date | null; workersCompExpires: Date | null; licenseExpires: Date | null }, today: Date, warnDays = 30): Compliance {
  const check = (label: string, date: Date | null, required: boolean): ComplianceItem | null => {
    if (!date) return required ? { label, date: null, status: "MISSING" } : null;
    if (day(date) < day(today)) return { label, date, status: "EXPIRED" };
    if (day(date) <= day(addDays(today, warnDays))) return { label, date, status: "EXPIRING" };
    return { label, date, status: "OK" };
  };
  const sub = c.kind === "SUB";
  const items = [check("Certificate of insurance", c.coiExpires, sub), check("Workers' comp", c.workersCompExpires, sub), check("License", c.licenseExpires, false)].filter((x): x is ComplianceItem => !!x);
  const status = items.reduce<ComplianceItem["status"]>((a, i) => (RANK[i.status] > RANK[a] ? i.status : a), "OK");
  return { status, items };
}

export const overlaps = (a: { startDate: Date; endDate: Date }, b: { startDate: Date; endDate: Date }) => day(a.startDate) <= day(b.endDate) && day(b.startDate) <= day(a.endDate);

type Ev = { id?: string; crewId: string | null; startDate: Date; endDate: Date; status: string; title: string };
/** Other live events that put the same crew in two places at once. */
export function crewConflicts<T extends Ev>(e: Ev, others: T[]): T[] {
  if (!e.crewId) return [];
  return others.filter((o) => o.id !== e.id && o.crewId === e.crewId && o.status !== "CANCELLED" && o.status !== "DONE" && overlaps(e, o));
}

/** Labor or piece pay for a time entry. */
export function timeAmount(t: { basis: "HOURLY" | "PIECE"; hours?: number | null; qty?: number | null; unit?: string | null; rate: number; burdenPct?: number | null }) {
  if (!Number.isFinite(t.rate) || t.rate < 0) throw new Error("Enter the rate.");
  if (t.basis === "HOURLY") {
    if (t.hours == null || !Number.isFinite(t.hours) || t.hours <= 0) throw new Error("Enter total crew hours.");
    if (t.burdenPct == null || !Number.isFinite(t.burdenPct) || t.burdenPct < 0) throw new Error("Enter the burden % (0 if none).");
    const amount = round(t.hours * t.rate * (1 + t.burdenPct / 100), 2);
    return { amount, formula: `${t.hours} h × $${t.rate}/h × (1 + ${t.burdenPct}% burden) = ${amount.toFixed(2)}` };
  }
  if (t.qty == null || !Number.isFinite(t.qty) || t.qty <= 0 || !t.unit) throw new Error("Enter the quantity and unit completed.");
  const amount = round(t.qty * t.rate, 2);
  return { amount, formula: `${t.qty} ${t.unit} × $${t.rate}/${t.unit} = ${amount.toFixed(2)}` };
}

/** What a work order pays. PIECE = qty × rate, LUMP = agreed amount; HOURLY is paid from timesheets. */
export function workOrderPay(w: { payBasis: string | null; payQty: number | null; payUnit: string | null; payRate: number | null; amount: number | null }) {
  if (w.payBasis === "PIECE") {
    if (w.payQty == null || w.payRate == null || !w.payUnit) return { amount: null, formula: null };
    const amount = round(w.payQty * w.payRate, 2);
    return { amount, formula: `${w.payQty} ${w.payUnit} × $${w.payRate}/${w.payUnit} = ${amount.toFixed(2)}` };
  }
  if (w.payBasis === "LUMP") return { amount: w.amount, formula: w.amount == null ? null : "agreed lump sum" };
  return { amount: null, formula: "paid from timesheets" };
}
