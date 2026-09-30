import { round } from "@/lib/calc/core";
import { splitCsv } from "@/lib/sheets/parse";

// Parses a supplier invoice export (ABC Supply or similar) into cost lines. Column names vary by export,
// so headers are matched against known names. Rows without a usable amount are reported, never guessed.

const HEADERS = {
  invoice: ["invoice", "invoice #", "invoice number", "invoice no", "inv", "inv #", "document", "document #"],
  date: ["invoice date", "date", "ship date", "doc date"],
  item: ["item", "item #", "item number", "item no", "sku", "product", "product #", "part", "part #"],
  description: ["description", "item description", "desc", "product description"],
  qty: ["qty", "quantity", "ship qty", "qty shipped", "shipped", "quantity shipped"],
  uom: ["uom", "unit", "um", "u/m", "unit of measure"],
  unitPrice: ["price", "unit price", "net price", "each", "unit cost", "price each"],
  amount: ["amount", "extended", "ext price", "extended price", "ext amount", "extension", "line total", "total", "net amount"],
  tax: ["tax", "sales tax", "tax amount"],
  po: ["po", "po #", "po number", "customer po", "job", "job name", "job #"],
} as const;
type Field = keyof typeof HEADERS;

export type InvoiceRow = {
  line: number;
  invoice: string | null;
  date: string | null; // ISO yyyy-mm-dd
  po: string | null;
  itemNumber: string | null;
  description: string;
  quantity: number | null;
  uom: string | null;
  unitPrice: number | null;
  amount: number;
  formula: string | null; // set when the amount was qty × price
  tax: number | null;
};
export type InvoiceParse = { rows: InvoiceRow[]; problems: string[]; columns: Partial<Record<Field, string>>; pos: string[] };

const norm = (s: string) => s.toLowerCase().replace(/[._]/g, " ").replace(/\s+/g, " ").trim();
const money = (s: string | undefined) => {
  if (s == null) return null;
  let t = s.trim();
  if (!t) return null;
  const neg = /^\(.*\)$/.test(t) || t.endsWith("-");
  t = t.replace(/[()$,\s]/g, "").replace(/-$/, "");
  const n = Number(t);
  if (!Number.isFinite(n)) return NaN;
  return neg ? -Math.abs(n) : n;
};
function isoDate(s: string | undefined) {
  if (!s?.trim()) return null;
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

export function parseInvoiceCsv(csv: string): InvoiceParse {
  const lines = csv.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const problems: string[] = [];
  // header = first line that names an amount or price column
  const hIdx = lines.findIndex((l) => {
    const cells = splitCsv(l).map(norm);
    return cells.some((c) => (HEADERS.amount as readonly string[]).includes(c) || (HEADERS.unitPrice as readonly string[]).includes(c));
  });
  if (hIdx < 0) return { rows: [], problems: ["Couldn't find a header row with an Amount/Extended or Price column."], columns: {}, pos: [] };
  const head = splitCsv(lines[hIdx]).map(norm);
  const idx = {} as Record<Field, number>;
  const columns: Partial<Record<Field, string>> = {};
  for (const f of Object.keys(HEADERS) as Field[]) {
    idx[f] = head.findIndex((h) => (HEADERS[f] as readonly string[]).includes(h));
    if (idx[f] >= 0) columns[f] = splitCsv(lines[hIdx])[idx[f]];
  }
  if (idx.description < 0 && idx.item < 0) problems.push("No Description or Item column found.");
  const rows: InvoiceRow[] = [];
  let lastInvoice: string | null = null;
  let lastDate: string | null = null;
  for (let i = hIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    const c = splitCsv(raw);
    const get = (f: Field) => (idx[f] >= 0 ? (c[idx[f]] ?? "").trim() : "");
    const desc = get("description") || get("item");
    if (!desc && !get("amount")) continue;
    // subtotal / total rows restate numbers already on lines
    if (/^(sub ?total|invoice total|total|grand total)\b/i.test(desc)) continue;
    const invoice: string | null = get("invoice") || lastInvoice;
    const date: string | null = isoDate(get("date")) ?? (invoice === lastInvoice ? lastDate : null);
    lastInvoice = invoice;
    lastDate = date;
    const qty = money(get("qty"));
    const price = money(get("unitPrice"));
    let amount = money(get("amount"));
    let formula: string | null = null;
    if ((amount == null || Number.isNaN(amount)) && qty != null && price != null && !Number.isNaN(qty) && !Number.isNaN(price)) {
      amount = round(qty * price, 2);
      formula = `${qty} × ${price} = ${amount.toFixed(2)}`;
    }
    if (amount == null || Number.isNaN(amount)) {
      problems.push(`Line ${i + 1}: "${desc}" has no amount (and no qty × price). Not imported.`);
      continue;
    }
    const tax = money(get("tax"));
    rows.push({
      line: i + 1,
      invoice,
      date,
      po: get("po") || null,
      itemNumber: get("item") || null,
      description: get("description") || get("item"),
      quantity: qty == null || Number.isNaN(qty) ? null : qty,
      uom: get("uom").toUpperCase() || null,
      unitPrice: price == null || Number.isNaN(price) ? null : price,
      amount,
      formula,
      tax: tax == null || Number.isNaN(tax) || tax === 0 ? null : tax,
    });
  }
  if (!rows.length && !problems.length) problems.push("No invoice lines found under the header row.");
  const pos = [...new Set(rows.map((r) => r.po).filter((p): p is string => !!p))];
  return { rows, problems, columns, pos };
}
