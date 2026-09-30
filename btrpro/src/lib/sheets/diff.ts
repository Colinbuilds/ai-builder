// Diff between the live version of a sheet and a newly parsed upload (review screen).
export type DiffItem = {
  itemNumber: string;
  description: string;
  unitPrice: number | null;
  priceStatus: "LISTED" | "CALL";
  uom: string;
};

export type Change = {
  itemNumber: string;
  before: DiffItem;
  after: DiffItem;
  fields: ("price" | "status" | "uom" | "description")[];
  pctChange: number | null; // price change, when both prices exist
};

export function diffSheet(oldItems: DiffItem[], newItems: DiffItem[]) {
  const oldBy = new Map(oldItems.map((i) => [i.itemNumber, i]));
  const newBy = new Map(newItems.map((i) => [i.itemNumber, i]));
  const added = newItems.filter((i) => !oldBy.has(i.itemNumber));
  const removed = oldItems.filter((i) => !newBy.has(i.itemNumber));
  const changed: Change[] = [];
  let unchanged = 0;
  for (const after of newItems) {
    const before = oldBy.get(after.itemNumber);
    if (!before) continue;
    const fields: Change["fields"] = [];
    if (before.priceStatus !== after.priceStatus) fields.push("status");
    if ((before.unitPrice ?? null) !== (after.unitPrice ?? null)) fields.push("price");
    if (before.uom !== after.uom) fields.push("uom");
    if (before.description !== after.description) fields.push("description");
    if (!fields.length) {
      unchanged++;
      continue;
    }
    const pctChange =
      before.unitPrice && after.unitPrice != null
        ? Math.round(((after.unitPrice - before.unitPrice) / before.unitPrice) * 1000) / 10
        : null;
    changed.push({ itemNumber: after.itemNumber, before, after, fields, pctChange });
  }
  return { added, removed, changed, unchanged };
}

/** Problems that block saving an upload. */
export function validateRows(rows: (DiffItem & { line?: number })[], uoms: readonly string[]) {
  const errors: string[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const at = `Row ${i + 1}${r.itemNumber ? ` (${r.itemNumber})` : ""}`;
    if (!r.itemNumber.trim()) errors.push(`${at}: item number is empty.`);
    else if (seen.has(r.itemNumber)) errors.push(`${at}: item number appears more than once.`);
    seen.add(r.itemNumber);
    if (!r.description.trim()) errors.push(`${at}: description is empty.`);
    if (!uoms.includes(r.uom)) errors.push(`${at}: UOM "${r.uom}" is not one of ${uoms.join(", ")}.`);
    if (r.priceStatus === "LISTED" && (r.unitPrice == null || !Number.isFinite(r.unitPrice) || r.unitPrice < 0))
      errors.push(`${at}: price must be a number, or mark the row CALL.`);
  });
  return errors;
}
