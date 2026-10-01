// Pure checks on a transcribed receipt: line math, totals, job matching, and price comparison.
// No AI here — every number shown is either printed on the receipt or computed by this code with its formula.
import { round } from "@/lib/calc/core";
import { streetKey } from "@/lib/integrations/drive-photos";

export type ReceiptLine = { itemNumber: string | null; description: string; quantity: number | null; uom: string | null; unitPrice: number | null; extendedPrice: number | null; orderedQuantity?: number | null; handwritten?: boolean };
export type Receipt = {
  documentType?: "RECEIPT" | "INVOICE" | "DELIVERY_TICKET" | "OTHER";
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
export type JobMatch = { projectId: string; by: string; score: number };
/** Extra text that came with the receipt (email subject and message, or the uploader's note). */
export type ReceiptContext = { subject?: string | null; message?: string | null; ownAddresses?: readonly string[] };

const STOP = new Set(["the", "job", "po", "lot", "llc", "inc", "co", "and", "of", "roof", "reroof", "roofing", "siding", "gutters", "gutter", "repair", "test_only", "st", "ave", "rd", "dr", "ln", "ct", "omaha", "ne"]);
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
const key = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[\s-]+/g, "");

/** Every "house number + street word" in a piece of text (an email can mention quantities before the address). */
export function streetKeys(text: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const m of (text ?? "").toLowerCase().matchAll(/\b(\d{2,6})\s+(?:[nsew]\.?\s+)?([a-z][a-z0-9]*)/g)) out.add(`${m[1]} ${m[2]}`);
  return [...out];
}

/**
 * Scores every job against the receipt: our PO / ABC order # or old job # = 100, the ship-to street address = 95
 * (100 with the name too), the job name alone at most 85. A job is picked only when one clearly wins at 95+;
 * otherwise the receipt waits for someone to choose from the closest matches.
 */
export function matchReceiptJob(r: Receipt, jobs: JobRow[], orders: OrderRow[], ctx: ReceiptContext = {}): { match: JobMatch | null; candidates: JobMatch[] } {
  const refs = [r.poNumber, r.orderNumber, r.invoiceNumber].map(key).filter((k) => k.length >= 3);
  const texts = [r.jobName, r.poNumber, r.shipToName, ctx.subject, ctx.message].filter((t): t is string => !!t && t.trim().length >= 3);
  const pool = new Set(texts.flatMap(words));
  // BTR's own office/shop addresses say nothing about the job
  const own = new Set((ctx.ownAddresses ?? []).flatMap(streetKeys));
  const addrKeys = new Set([r.shipToAddress, r.jobName, r.poNumber, ctx.subject, ctx.message].flatMap(streetKeys).filter((k) => !own.has(k)));
  const poWords = [...new Set(words(r.poNumber ?? "").filter((w) => w.length >= 3 && !/^\d+$/.test(w)))];
  const open = (j: JobRow) => !["LOST", "CLOSED"].includes(j.status);
  // how many job names use each word: a word only a few jobs share (a surname, a subdivision) is a strong hint
  const df = new Map<string, number>();
  for (const j of jobs) for (const w of new Set(words(j.name))) df.set(w, (df.get(w) ?? 0) + 1);
  const scored: JobMatch[] = [];
  for (const j of jobs) {
    let score = 0;
    let by = "";
    const ord = orders.find((o) => o.projectId === j.id && (refs.includes(key(o.number)) || (o.supplierOrderNumber && refs.includes(key(o.supplierOrderNumber)))));
    if (ord) [score, by] = [100, `PO / order # ${ord.number}`];
    else if (j.acculynxJobNumber && refs.includes(key(j.acculynxJobNumber))) [score, by] = [100, `job # ${j.acculynxJobNumber}`];
    const jw = [...new Set(words(j.name).filter((w) => w.length >= 3 && !/^\d+$/.test(w)))];
    const hits = jw.filter((w) => pool.has(w));
    const nameHit = hits.length ? (hits.some((w) => (df.get(w) ?? 0) <= 3 && w.length >= 4) || hits.length >= 2 ? 1 : 0.6) : 0;
    const addr = streetKeys(j.address).some((k) => addrKeys.has(k));
    if (score < 100 && addr) [score, by] = nameHit > 0 ? [100, "address and job name"] : [95, "ship-to address"];
    // BTR writes the job (customer) name in the PO: every PO word in this job's name, and the name is rare enough
    const jobWords = new Set(words(j.name));
    if (score < 95 && poWords.length && poWords.every((w) => jobWords.has(w)) && (poWords.length >= 2 || (df.get(poWords[0]) ?? 0) <= 1))
      [score, by] = [95, `PO "${r.poNumber}" = job name`];
    if (score < 85 && nameHit > 0) [score, by] = [Math.round(85 * nameHit), "job name"];
    if (!score) continue;
    if (!open(j)) score = Math.max(0, score - 15); // closed/lost jobs only if nothing else fits
    scored.push({ projectId: j.id, by, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const [top, next] = scored;
  // our PO / ABC order # / old job # is decisive when exactly one job carries it
  const byRef = scored.filter((c) => /^(PO|job #)/.test(c.by));
  if (byRef.length === 1) return { match: byRef[0], candidates: scored.slice(0, 5) };
  const clear = top && top.score >= 95 && (!next || next.score <= top.score - 10);
  return { match: clear ? top : null, candidates: scored.filter((c) => c.score >= 30).slice(0, 5) };
}

export { DEFAULT_RECEIPT_MARKUP, receiptPricing, type PricedLine } from "./pricing";

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
