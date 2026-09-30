// Coverage parsing from price-sheet descriptions (BUILD_PROMPT §1).
// Only explicit patterns are read. Anything ambiguous returns null, so the
// calc engine shows MISSING and asks the user. Example: "9X50" on a flashing
// tape is 9 inches, not 9 feet, so unit-less roll sizes are never read.

export type Coverage = {
  qty: number;
  /** e.g. "BD/SQ", "SQ/RL", "LF/BD", "SF/RL", "SF/SH", "EA/BX" */
  unit: string;
  /** the text in the description that produced this value */
  matched: string;
};

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const round = (n: number) => Math.round(n * 1000) / 1000;
const SHEET_UOMS = new Set(["SH", "PNL"]);
const CONTAINER_UOMS = new Set(["BX", "PA"]);

type Rule = (desc: string, uom: string) => Coverage | null;

const rules: Rule[] = [
  // "3/SQ" → bundles per square (shingles sold by the SQ)
  (d) => {
    const m = d.match(new RegExp(String.raw`(?<![\d.])${NUM}\s?/\s?SQ\b`, "i"));
    return m ? { qty: +m[1], unit: "BD/SQ", matched: m[0] } : null;
  },
  // "10SQ", "2SQ", "2SQ/RL", "2SQ/BD" → squares per sold unit
  (d, uom) => {
    const m = d.match(new RegExp(String.raw`(?<![\d./])${NUM}\s?SQ\b`, "i"));
    return m ? { qty: +m[1], unit: `SQ/${uom}`, matched: m[0] } : null;
  },
  // "116'4" LF" → feet + inches per sold unit
  (d, uom) => {
    const m = d.match(/(?<![\d.])(\d+)'\s?(\d+(?:\.\d+)?)"\s?LF\b/i);
    return m ? { qty: round(+m[1] + +m[2] / 12), unit: `LF/${uom}`, matched: m[0] } : null;
  },
  // "31LF", "33.3LF", "120.33LF" → LF per sold unit
  (d, uom) => {
    const m = d.match(new RegExp(String.raw`(?<![\d.'"])${NUM}\s?LF\b`, "i"));
    return m ? { qty: +m[1], unit: `LF/${uom}`, matched: m[0] } : null;
  },
  // "10'X100'", "9' x 150'", "4'X8'" → SF per sold unit (both sides marked in feet)
  (d, uom) => {
    const m = d.match(new RegExp(String.raw`(?<![\d.X])${NUM}'\s?X\s?${NUM}'(?!\s?X)`, "i"));
    return m ? { qty: round(+m[1] * +m[2]), unit: `SF/${uom}`, matched: m[0] } : null;
  },
  // "4X8", "4x10" on sheet goods (SH/PNL) → standard 4-ft-wide boards, SF per sheet
  (d, uom) => {
    if (!SHEET_UOMS.has(uom)) return null;
    const m = d.match(/(?<![\d.X"'])4\s?X\s?(\d{1,2})(?![\d."'X])/i);
    return m ? { qty: 4 * +m[1], unit: `SF/${uom}`, matched: m[0] } : null;
  },
  // Count per box/pail: "2000/BX", "4/Box", "3000/Pail", "1M", "4.8M", "5C", trailing "250"
  (d, uom) => {
    if (!CONTAINER_UOMS.has(uom)) return null;
    const unit = `EA/${uom}`;
    let m = d.match(/(?<![\d.#])(\d+)\s?\/\s?(BX|Box|Pail)\b/i);
    if (m) return { qty: +m[1], unit, matched: m[0] };
    m = d.match(new RegExp(String.raw`(?<![\d.#/-])${NUM}M\b`));
    if (m) return { qty: round(+m[1] * 1000), unit, matched: m[0] };
    m = d.match(/(?<![\d.#/-])(\d+)C\b/);
    if (m) return { qty: +m[1] * 100, unit, matched: m[0] };
    if (uom === "BX") {
      m = d.match(/\s(\d{2,5})$/);
      if (m) return { qty: +m[1], unit, matched: m[1] };
    }
    return null;
  },
];

export function parseCoverage(description: string, uom: string): Coverage | null {
  const d = description.trim();
  for (const rule of rules) {
    const c = rule(d, uom.toUpperCase());
    if (c && c.qty > 0) return c;
  }
  return null;
}
