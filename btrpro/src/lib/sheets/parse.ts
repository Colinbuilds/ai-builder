// Parses BTR / ABC Supply price-sheet text into rows (CLAUDE.md §5).
// Row format: item number, description (may wrap onto several lines), "$price" or CALL, UOM.
// Section headers are numbered ("3. Plastic Cap Nails"). Anything else is reported as unparsed
// so the admin can see it on the review screen. Nothing goes live without review.

export const UOMS = ["PC", "PNL", "SH", "BX", "BD", "RL", "SQ", "EA", "PK", "KT", "TB", "DR", "PA", "CN", "GA", "BO", "PT"] as const;
export type Uom = (typeof UOMS)[number];

export type ParsedRow = {
  section: string;
  itemNumber: string;
  description: string;
  unitPrice: number | null;
  priceStatus: "LISTED" | "CALL";
  uom: string;
  line: number; // 1-based line where the row started
  /** description continued on a line after the price (table-style PDFs); worth a look on review */
  wrapped?: boolean;
};

export type ParsedHeader = {
  effective: string | null; // YYYY-MM-DD
  expiration: string | null;
  account: string | null;
  salesRep: string | null;
};

export type ParseResult = { header: ParsedHeader; rows: ParsedRow[]; unparsed: { line: number; text: string }[] };

const UOM_RE = UOMS.join("|");
const ROW_RE = new RegExp(
  String.raw`^(?<item>[A-Z0-9][A-Z0-9-]{3,})\s+(?<desc>.+?)\s+(?:\$\s?(?<price>[\d,]+(?:\.\d+)?)|(?<call>CALL(?:\s+FOR\s+PRICE)?))\s+(?<uom>${UOM_RE})$`,
  "i",
);
const PRICE_RE = /\$\s?[\d,]+(?:\.\d+)?|\bCALL\b/i;
// An item # has a digit and 4+ characters; followed by the description, or alone on its line
// (6+ characters then, so a wrapped "70LF" isn't mistaken for an item number).
const ITEM_START_RE = /^(?=[A-Z0-9-]*\d)(?:[A-Z0-9][A-Z0-9-]{3,}\s+\S|[A-Z0-9][A-Z0-9-]{5,}$)/;
const SECTION_RE = /^(\d{1,3})[.)]?\s+([A-Za-z].*)$/;
// Page furniture and header fields — never part of a description.
const NOISE_RE = /^(page \d+( of \d+)?|.*\b(account|rep|effective|expir\w*|valid)\b.*[:\-].*)$/i;

const DATE = String.raw`(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})`;

export function toIsoDate(s: string): string | null {
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  const mo = +m[1], d = +m[2];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseHeader(text: string): ParsedHeader {
  const find = (re: RegExp) => text.match(re)?.[1]?.trim() ?? null;
  const eff = find(new RegExp(String.raw`Effective(?:\s+Date)?\s*[:\-]?\s*${DATE}`, "i"));
  const exp = find(new RegExp(String.raw`(?:Expir\w*|Valid\s+(?:Through|Until))(?:\s+Date)?\s*[:\-]?\s*${DATE}`, "i"));
  return {
    effective: eff ? toIsoDate(eff) : null,
    expiration: exp ? toIsoDate(exp) : null,
    account: find(/Account(?:\s*(?:#|No\.?|Number))?\s*[:\-]\s*([^\n]+)/i),
    salesRep: find(/(?:Sales\s*)?Rep(?:resentative)?\s*[:\-]\s*([^\n]+)/i),
  };
}

export function parseSheetText(text: string): ParseResult {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const rows: ParsedRow[] = [];
  const unparsed: ParseResult["unparsed"] = [];
  let section = "";
  let buf = "";
  let bufLine = 0;
  let bufLines: { line: number; text: string }[] = [];
  let lastRowLine = -1; // line number of the last line consumed by a completed row

  const flushOpen = () => {
    if (buf) unparsed.push(...bufLines);
    buf = "";
    bufLines = [];
  };

  lines.forEach((raw, i) => {
    const text = raw.replace(/\s+/g, " ").trim();
    const lineNo = i + 1;
    if (!text) return;

    if (!buf) {
      const sec = text.match(SECTION_RE);
      if (sec && !PRICE_RE.test(text)) {
        section = sec[2].trim();
        return;
      }
      if (!ITEM_START_RE.test(text)) {
        const prev = rows[rows.length - 1];
        // Table-style PDFs put a wrapped description on the line after the price.
        if (prev && lastRowLine === lineNo - 1 && !PRICE_RE.test(text) && !NOISE_RE.test(text)) {
          prev.description = joinWrapped(prev.description, text);
          prev.wrapped = true;
          lastRowLine = lineNo;
          return;
        }
        unparsed.push({ line: lineNo, text });
        return;
      }
      bufLine = lineNo;
    } else if (PRICE_RE.test(buf) && ITEM_START_RE.test(text) && !new RegExp(`^(${UOM_RE})\\b`, "i").test(text)) {
      // Previous row had a price but never got a UOM; report it and start fresh.
      flushOpen();
      bufLine = lineNo;
    }

    buf = buf ? joinWrapped(buf, text) : text;
    bufLines.push({ line: lineNo, text });
    const m = buf.match(ROW_RE);
    if (m?.groups) {
      const g = m.groups;
      rows.push({
        section,
        itemNumber: g.item.toUpperCase(),
        description: g.desc.trim(),
        unitPrice: g.call ? null : Number(g.price.replace(/,/g, "")),
        priceStatus: g.call ? "CALL" : "LISTED",
        uom: g.uom.toUpperCase(),
        line: bufLine,
      });
      buf = "";
      bufLines = [];
      lastRowLine = lineNo;
    } else if (bufLines.length > 6) {
      // A real description never wraps this far; stop swallowing lines.
      flushOpen();
    }
  });
  flushOpen();

  return { header: parseHeader(text), rows, unparsed };
}

// "Coil Nail ABC 1-" + "3/4\" EG" → "Coil Nail ABC 1-3/4\" EG"
const joinWrapped = (a: string, b: string) => (/\d-$/.test(a) ? `${a}${b}` : `${a} ${b}`);

/** Parses a CSV in the same layout as data/price_items.csv. */
export function parsePriceCsv(csv: string): ParseResult | null {
  const lines = csv.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim());
  const head = splitCsv(lines[0] ?? "");
  const col = (n: string) => head.indexOf(n);
  if (["item_number", "description", "unit_price", "uom"].some((n) => col(n) < 0)) return null;
  const rows: ParsedRow[] = [];
  let eff: string | null = null;
  let exp: string | null = null;
  lines.slice(1).forEach((l, i) => {
    const c = splitCsv(l);
    const status = (c[col("price_status")] ?? "").toUpperCase();
    const isCall = status.startsWith("CALL") || !c[col("unit_price")];
    rows.push({
      section: col("section") >= 0 ? c[col("section")] : "",
      itemNumber: c[col("item_number")],
      description: c[col("description")],
      unitPrice: isCall ? null : Number(c[col("unit_price")]),
      priceStatus: isCall ? "CALL" : "LISTED",
      uom: c[col("uom")].toUpperCase(),
      line: i + 2,
    });
    if (col("effective_date") >= 0) eff ??= c[col("effective_date")] || null;
    if (col("expiration_date") >= 0) exp ??= c[col("expiration_date")] || null;
  });
  return {
    header: { effective: eff && toIsoDate(eff), expiration: exp && toIsoDate(exp), account: null, salesRep: null },
    rows,
    unparsed: [],
  };
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") out.push(cur), (cur = "");
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
