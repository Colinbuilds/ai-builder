// TEST_ONLY synthetic builder master sheet in the same block layout as a real one (made-up models and prices).
import JSZip from "jszip";
import type { Tab } from "@/lib/import/xlsx";

export const TAX = 0.1, MK = 0.05, LAB = 40, LMK = 10, BOOT = 100, FUEL = 25;
const grid = (h: number, w = 12) => Array.from({ length: h }, () => Array<string>(w).fill(""));

// one roofing block: materials, cost/tax/profit, squares, labor cost/profit, payout, overall
function roofBlock(g: string[][], r: number, model: string, label: string, mats: [string, number, number][], sq: number) {
  const elev = /^[A-Z]$/.test(label);
  const mc = mats.reduce((a, m) => a + m[2], 0);
  const boot = elev ? BOOT : 0;
  g[r][0] = "Model Type";
  g[r + 1][0] = model;
  g[r + 1][2] = label;
  let i = r + 2;
  for (const [n, q, c] of mats) (g[i][2] = n), (g[i][3] = String(q)), (g[i++][4] = String(c));
  (g[i][1] = "Cost (per house)"), (g[i++][3] = String(mc));
  (g[i][1] = "Tax (per house)"), (g[i++][3] = String(mc * TAX));
  (g[i][1] = "Profit (per house)"), (g[i++][3] = String(mc * MK));
  (g[i][2] = "Asphalt (SQ)"), (g[i++][3] = String(sq));
  (g[i][1] = "Cost (per house)"), (g[i++][3] = String(sq * LAB + boot));
  (g[i][1] = "Profit (per house)"), (g[i++][3] = String(sq * LMK));
  (g[i][0] = "Payout"), (g[i++][3] = String(sq * LAB + boot));
  (g[i][0] = "Overall"), (g[i++][3] = String(mc * (1 + TAX + MK) + sq * (LAB + LMK) + boot));
  return i + 1;
}
function gutBlock(g: string[][], r: number, model: string, label: string, mats: [string, number, number | null][]) {
  const priced = mats.filter((m) => m[2] != null);
  const mc = priced.reduce((a, m) => a + m[2]!, 0);
  const lf = priced.reduce((a, m) => a + m[1], 0);
  g[r][0] = "Model Type";
  g[r + 1][0] = model;
  g[r + 1][2] = label;
  let i = r + 2;
  for (const [n, q, c] of mats) (g[i][2] = n), (g[i][3] = String(q)), (g[i++][4] = c == null ? "" : String(c));
  (g[i][1] = "Cost (per house)"), (g[i++][3] = String(mc));
  (g[i][0] = "Payout"), (g[i++][3] = String(mc));
  (g[i][0] = "Overall"), (g[i++][3] = String(lf * 4.5));
  return i + 1;
}

export function workbook(): Tab[] {
  const roof = grid(120);
  roof[0][0] = "Material"; roof[0][1] = "Cost";
  roof[1][0] = "TEST_ONLY Shingle"; roof[1][1] = "100";
  roof[2][0] = "TEST_ONLY Starter"; roof[2][1] = "20";
  roof[0][6] = "Master Tax Rate"; roof[1][6] = String(TAX);
  roof[2][6] = "Master Mark Up"; roof[3][6] = String(MK);
  roof[4][6] = "Asphalt Shingles (SQ)"; roof[4][8] = String(LAB); roof[4][9] = String(LMK);
  roof[5][6] = "Boot Trip Charge"; roof[5][8] = String(BOOT);
  roof[6][6] = "Fuel Surcharge"; roof[7][6] = String(FUEL);
  let r = 10;
  r = roofBlock(roof, r, "TEST_ONLY Aspen", "A", [["TEST_ONLY Shingle", 30, 3000], ["TEST_ONLY Starter", 2, 40]], 30);
  r = roofBlock(roof, r, "TEST_ONLY Aspen", "B", [["TEST_ONLY Shingle", 32, 3200], ["TEST_ONLY Starter", 2, 40]], 32);
  r = roofBlock(roof, r, "TEST_ONLY Aspen", "3 Car (B Only)", [["TEST_ONLY Shingle", 4, 400]], 4);
  r = roofBlock(roof, r, "TEST_ONLY Aspen", "Covered Rear Porch", [["TEST_ONLY Shingle", 2, 200]], 2);
  roofBlock(roof, r, "TEST_ONLY Birch", "A", [["TEST_ONLY Shingle", 25, 2500], ["TEST_ONLY Starter", 0, 0]], 25);
  const gut = grid(60);
  gut[0][0] = "Material"; gut[0][1] = "Cost"; gut[0][2] = "Mark";
  gut[1][0] = '5" K Style'; gut[1][1] = "4"; gut[1][2] = "0.5";
  gut[2][0] = "Downspouts"; gut[2][1] = "4"; gut[2][2] = "0.5";
  gut[0][6] = "WO/DL Options"; gut[1][7] = "20"; gut[1][8] = "90";
  let q = 6;
  q = gutBlock(gut, q, "TEST_ONLY Aspen", "A", [['5" Gutter', 100, 400], ["Elbows", 10, null], ["Downspouts", 50, 200]]);
  q = gutBlock(gut, q, "TEST_ONLY Aspen", "B", [['5" Gutter', 110, 440], ["Downspouts", 50, 200]]);
  q = gutBlock(gut, q, "TEST_ONLY Aspen", "3 Car", [['5" Gutter', 20, 80]]);
  gutBlock(gut, q, "TEST_ONLY Birch", "A", [['5" Gutter', 90, 360], ["Downspouts", 40, 160]]);
  const old = [["PLANS", "A", "B"], ["TEST_ONLY Aspen(1500)", "7000", "7200"]];
  return [{ name: "Master Sheet Asphalt", rows: roof }, { name: "Master Gutter Sheet", rows: gut }, { name: "Old Pricing", rows: [["Sell"], ...old] }];
}

export async function toXlsx(tabs: Tab[]) {
  const z = new JSZip();
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const col = (c: number) => (c < 26 ? "" : String.fromCharCode(64 + Math.floor(c / 26))) + String.fromCharCode(65 + (c % 26));
  z.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`);
  z.file("xl/workbook.xml", `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${tabs.map((t, i) => `<sheet name="${esc(t.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  z.file("xl/_rels/workbook.xml.rels", `<Relationships>${tabs.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`);
  tabs.forEach((t, i) =>
    z.file(
      `xl/worksheets/sheet${i + 1}.xml`,
      `<worksheet><sheetData>${t.rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => (v === "" ? "" : `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`)).join("")}</row>`).join("")}</sheetData></worksheet>`,
    ),
  );
  return new Uint8Array(await z.generateAsync({ type: "uint8array" }));
}

