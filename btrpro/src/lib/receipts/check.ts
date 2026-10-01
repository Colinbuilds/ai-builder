// Pure checks on a transcribed receipt: line math, totals, job matching, and price comparison.
// No AI here — every number shown is either printed on the receipt or computed by this code with its formula.
import { round } from "@/lib/calc/core";
import { streetKey } from "@/lib/integrations/drive-photos";

export type ReceiptLine = { itemNumber: string | null; description: string; quantity: number | null; uom: string | null; unitPrice: number | null; extendedPrice: number | null };
export type Receipt = {
  vendor: string | null;
  branch: string | null;
  invoiceNumber: string | null;
  orderNumber: string | null;
  poNumber: string | null;
  jobName: string | null;
  shipToName: string | null;
  shipToAddress: string | null;
  date: string | null;
  lines: ReceiptLine[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  notes: string[];
};

const money = (n: number) => `$${n.toFixed(2)}`;

/** Line amount: the printed extended price, or qty × unit price (computed here, with the formula) when only those are printed. */
export function lineAmount(l: ReceiptLine): { amount: number | null; formula: string | null; mathFlag: string | null } {
  const calc = l.quantity != null && l.unitPrice != null ? round(l.quantity * l.unitPrice, 2) : null;
  if (l.extendedPrice != null) {
    const mathFlag = calc != null && Math.abs(calc - l.extendedPrice) > 0.02 ? `printed ${money(l.extendedPrice)} but ${l.quantity} × ${money(l.unitPrice!)} = ${money(calc)}` : null;
    return { amount: l.extendedPrice, formula: null, mathFlag };
  }
  if (calc != null) return { amount: calc, formula: `${l.quantity} × ${money(l.unitPrice!)}`, mathFlag: null };
  return { amount: null, formula: null, mathFlag: null };
}

export function totalsCheck(r: Receipt) {
  const amounts = r.lines.map((l) => lineAmount(l).amount);
  const known = amounts.every((a) => a != null);
  const sum = round(amounts.reduce<number>((a, b) => a + (b ?? 0), 0), 2);
  const flags: string[] = [];
  if (!known) flags.push("Some lines have no amount printed — they can't be filed until entered by hand.");
  if (known && r.subtotal != null && Math.abs(sum - r.subtotal) > 0.02) flags.push(`Lines add up to ${money(sum)} but the printed subtotal is ${money(r.subtotal)}.`);
  const base = r.subtotal ?? (known ? sum : null);
  if (base != null && r.tax != null && r.total != null && Math.abs(round(base + r.tax, 2) - r.total) > 0.02)
    flags.push(`Subtotal ${money(base)} + tax ${money(r.tax)} = ${money(round(base + r.tax, 2))}, but the printed total is ${money(r.total)}.`);
  return { sum, flags };
}

// ---------- job matching ----------

export type JobRow = { id: string; name: string; address: string | null; status: string; acculynxJobNumber: string | null; clientName: string | null };
export type OrderRow = { projectId: string; number: string; supplierOrderNumber: string | null };
export type JobMatch = { projectId: string; by: string };

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !["the", "job", "po", "lot", "llc", "inc", "co", "and", "of"].includes(w));
const key = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[\s-]+/g, "");

/** Which job a receipt is for: our PO / ABC order # first, then the ship-to street address, then the job name. Only a single clear match is picked. */
export function matchReceiptJob(r: Receipt, jobs: JobRow[], orders: OrderRow[]): { match: JobMatch | null; candidates: JobMatch[] } {
  const found: JobMatch[] = [];
  const add = (projectId: string, by: string) => !found.some((f) => f.projectId === projectId) && found.push({ projectId, by });
  const refs = [r.poNumber, r.orderNumber, r.invoiceNumber].map(key).filter(Boolean);
  const byOrder = orders.filter((o) => refs.includes(key(o.number)) || (o.supplierOrderNumber && refs.includes(key(o.supplierOrderNumber))));
  const orderJobs = [...new Set(byOrder.map((o) => o.projectId))];
  if (orderJobs.length === 1) return { match: { projectId: orderJobs[0], by: `PO / order # ${byOrder[0].number}` }, candidates: [{ projectId: orderJobs[0], by: "PO / order #" }] };
  orderJobs.forEach((id) => add(id, "PO / order #"));
  const oldNo = jobs.filter((j) => j.acculynxJobNumber && refs.includes(key(j.acculynxJobNumber)));
  if (oldNo.length === 1 && !found.length) return { match: { projectId: oldNo[0].id, by: `job # ${oldNo[0].acculynxJobNumber}` }, candidates: [{ projectId: oldNo[0].id, by: "job #" }] };
  const sk = streetKey(r.shipToAddress) ?? streetKey(r.jobName) ?? streetKey(r.poNumber);
  const byAddr = sk ? jobs.filter((j) => streetKey(j.address) === sk) : [];
  const open = (js: JobRow[]) => (js.length > 1 ? js.filter((j) => !["LOST", "CLOSED", "PAID"].includes(j.status)) : js);
  const addrHits = open(byAddr);
  if (addrHits.length === 1 && !found.length) return { match: { projectId: addrHits[0].id, by: `ship-to address (${sk})` }, candidates: [{ projectId: addrHits[0].id, by: "address" }] };
  addrHits.forEach((j) => add(j.id, "address"));
  const texts = [r.jobName, r.poNumber, r.shipToName].filter((t): t is string => !!t && t.trim().length >= 3);
  const nameHits = open(
    jobs.filter((j) => {
      const jw = words(j.name);
      if (!jw.length) return false;
      return texts.some((t) => {
        const tw = words(t);
        if (!tw.length) return false;
        // every word of the shorter name appears in the other
        const [a, b] = tw.length <= jw.length ? [tw, jw] : [jw, tw];
        return a.length >= 1 && a.every((w) => b.includes(w)) && a.join("").length >= 4;
      });
    }),
  );
  if (nameHits.length === 1 && !found.length) return { match: { projectId: nameHits[0].id, by: `job name ("${texts[0]}")` }, candidates: [{ projectId: nameHits[0].id, by: "job name" }] };
  nameHits.forEach((j) => add(j.id, "job name"));
  return { match: null, candidates: found.slice(0, 10) };
}

// ---------- price check ----------

export type SheetPrice = { code: string; name: string; unitPrice: number | null; uom: string; builder: boolean; description: string };
export type PriceCheck = {
  status: "OK" | "OVER" | "UNDER" | "NO_ITEM_NUMBER" | "NOT_ON_SHEETS" | "NOT_ON_BUILDER" | "UOM" | "CALL" | "NO_PRICE";
  compared: SheetPrice | null;
  standard: SheetPrice | null;
  diffEach: number | null;
  diffTotal: number | null;
  note: string;
};

/**
 * Compare one receipt line with the price sheets. Builder jobs use the builder's negotiated price; standard jobs use
 * BTR's sheets. The UOM must match exactly — nothing is converted.
 */
export function priceCheckLine(
  l: ReceiptLine,
  rows: SheetPrice[],
  scope: { builderName: string | null; fallback: "STANDARD" | "MISSING" | null },
): PriceCheck {
  const standard = rows.find((r) => !r.builder) ?? null;
  const builderRow = rows.find((r) => r.builder) ?? null;
  const base = { standard, diffEach: null, diffTotal: null };
  if (!l.itemNumber) return { ...base, status: "NO_ITEM_NUMBER", compared: null, note: "No item number printed on this line." };
  if (!rows.length) return { ...base, status: "NOT_ON_SHEETS", compared: null, note: "Not on any of our price sheets." };
  let compared: SheetPrice | null;
  if (scope.builderName) {
    compared = builderRow ?? (scope.fallback === "STANDARD" ? standard : null);
    if (!compared)
      return { ...base, status: "NOT_ON_BUILDER", compared: null, note: `Not on ${scope.builderName}'s pricing${standard?.unitPrice != null ? ` (BTR standard is $${standard.unitPrice.toFixed(2)}/${standard.uom})` : ""}.` };
  } else compared = standard;
  if (!compared) return { ...base, status: "NOT_ON_SHEETS", compared: null, note: "Only on a builder's pricing, and this isn't that builder's job." };
  const tag = compared.builder ? `${scope.builderName} ${compared.code}` : `sheet ${compared.code}${scope.builderName ? " (BTR standard — builder falls back)" : ""}`;
  if (compared.unitPrice == null) return { ...base, compared, status: "CALL", note: `CALL for price on ${tag} — get a quote.` };
  if (l.unitPrice == null) return { ...base, compared, status: "NO_PRICE", note: `No unit price printed. ${tag}: $${compared.unitPrice.toFixed(2)}/${compared.uom}.` };
  if (!l.uom || l.uom.trim().toUpperCase() !== compared.uom.trim().toUpperCase())
    return { ...base, compared, status: "UOM", note: `Billed per ${l.uom ?? "?"}, ${tag} prices per ${compared.uom} — not compared (units aren't converted).` };
  const diffEach = round(l.unitPrice - compared.unitPrice, 2);
  const tol = Math.max(0.01, compared.unitPrice * 0.005);
  const diffTotal = l.quantity != null ? round(diffEach * l.quantity, 2) : null;
  if (Math.abs(diffEach) <= tol) return { standard, compared, diffEach: 0, diffTotal: 0, status: "OK", note: `Matches ${tag}.` };
  return {
    standard,
    compared,
    diffEach,
    diffTotal,
    status: diffEach > 0 ? "OVER" : "UNDER",
    note: `Billed $${l.unitPrice.toFixed(2)} vs $${compared.unitPrice.toFixed(2)} on ${tag} (${diffEach > 0 ? "+" : "−"}$${Math.abs(diffEach).toFixed(2)}/${compared.uom}${diffTotal != null ? ` × ${l.quantity} = ${diffTotal > 0 ? "+" : "−"}$${Math.abs(diffTotal).toFixed(2)}` : ""}).`,
  };
}
