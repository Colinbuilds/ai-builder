// Three-way match for supplier bills: what was ordered (our PO), what was delivered (delivery tickets) and what
// was billed, plus the price-sheet check. Pure — the screen and the approval run the same code.

export type BillLine = {
  itemNumber: string | null;
  description: string;
  quantity: number | null;
  uom: string | null;
  amount: number | null;
  /** price-sheet check from the receipt reader */
  priceStatus: string;
  priceNote: string;
  overBy: number | null;
};
export type OrderLine = { id: string; itemNumber: string | null; description: string; quantity: number | null; unit: string | null; received: number; returned: number };
export type LineFlag = "NOT_ON_PO" | "MORE_THAN_ORDERED" | "MORE_THAN_DELIVERED" | "OVER_SHEET" | "NO_AMOUNT" | "ALREADY_BILLED";
export type MatchedLine = {
  index: number;
  orderLineId: string | null;
  ordered: number | null;
  delivered: number | null;
  billedBefore: number;
  billed: number | null;
  flags: LineFlag[];
  notes: string[];
};
export type BillFlag = "NO_JOB" | "NO_PO" | "DUPLICATE" | "MATH" | "NO_DELIVERY";
export type BillMatch = { lines: MatchedLine[]; flags: BillFlag[]; notes: string[]; unbilled: { description: string; ordered: number | null; delivered: number }[]; ready: boolean };

const key = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 1);
/** Same item: item numbers equal, or (no item number) the first three meaningful words of the description agree. */
function sameItem(b: BillLine, o: OrderLine) {
  if (b.itemNumber && o.itemNumber) return key(b.itemNumber) === key(o.itemNumber);
  const a = words(b.description).slice(0, 3).join(" ");
  return !!a && a === words(o.description).slice(0, 3).join(" ");
}

export function matchBill(input: {
  lines: BillLine[];
  order: { number: string; lines: OrderLine[]; tickets: number } | null;
  hasJob: boolean;
  duplicateOf: string | null;
  mathFlags: string[];
  /** quantities already on earlier, non-void bills for the same order, by order line id */
  billedBefore: Record<string, number>;
}): BillMatch {
  const flags: BillFlag[] = [];
  const notes: string[] = [];
  if (!input.hasJob) {
    flags.push("NO_JOB");
    notes.push("Pick the job this bill is for.");
  }
  if (input.duplicateOf) {
    flags.push("DUPLICATE");
    notes.push(`Same vendor and invoice number as ${input.duplicateOf}. Possible double bill.`);
  }
  if (input.mathFlags.length) {
    flags.push("MATH");
    notes.push(...input.mathFlags);
  }
  if (!input.order) {
    flags.push("NO_PO");
    notes.push("No BTR purchase order matched (by PO or order number), so quantities can't be checked against what was ordered.");
  } else if (!input.order.tickets) {
    flags.push("NO_DELIVERY");
    notes.push(`No delivery ticket checked in on ${input.order.number} yet, so billed quantities can't be checked against what arrived.`);
  }
  const used = new Set<string>();
  const lines: MatchedLine[] = input.lines.map((b, index) => {
    const lf: LineFlag[] = [];
    const ln: string[] = [];
    const o = input.order?.lines.find((x) => !used.has(x.id) && sameItem(b, x)) ?? null;
    if (o) used.add(o.id);
    const before = o ? (input.billedBefore[o.id] ?? 0) : 0;
    const credit = (b.amount ?? 0) < 0 || (b.quantity ?? 0) < 0;
    if (b.amount == null) {
      lf.push("NO_AMOUNT");
      ln.push("No amount printed on this line.");
    }
    if (input.order && !o && !credit) {
      lf.push("NOT_ON_PO");
      ln.push(`Not on ${input.order.number}.`);
    }
    if (o && b.quantity != null && !credit) {
      const total = before + b.quantity;
      if (o.quantity != null && total > o.quantity + 1e-9) {
        lf.push("MORE_THAN_ORDERED");
        ln.push(`Billed ${b.quantity}${before ? ` (+${before} on earlier bills)` : ""}, ordered ${o.quantity}.`);
      }
      if (input.order!.tickets && total > o.received + 1e-9) {
        lf.push("MORE_THAN_DELIVERED");
        ln.push(`Billed ${b.quantity}${before ? ` (+${before} on earlier bills)` : ""}, delivered ${o.received}.`);
      }
      if (before > 0 && o.received > 0 && before >= o.received) {
        lf.push("ALREADY_BILLED");
        ln.push(`Everything delivered was already billed on earlier invoices.`);
      }
    }
    if (b.priceStatus === "OVER") {
      lf.push("OVER_SHEET");
      ln.push(b.priceNote);
    }
    return { index, orderLineId: o?.id ?? null, ordered: o?.quantity ?? null, delivered: o ? o.received : null, billedBefore: before, billed: b.quantity, flags: lf, notes: ln };
  });
  const unbilled = (input.order?.lines ?? [])
    .filter((o) => !used.has(o.id) && o.received > (input.billedBefore[o.id] ?? 0))
    .map((o) => ({ description: o.description, ordered: o.quantity, delivered: o.received }));
  // a missing PO or delivery ticket is a warning to look at, not a defect in the bill itself
  const blocking = flags.filter((f) => f !== "NO_DELIVERY");
  const ready = !blocking.length && lines.every((l) => !l.flags.length);
  return { lines, flags, notes, unbilled, ready };
}
