// Regenerates the TEST_ONLY price-sheet fixtures from real rows in data/price_items.json.
// Run from btrpro/: node test/fixtures/make-fixtures.mjs  (needs Playwright's Chromium for the PDF)
import { readFileSync, writeFileSync } from "node:fs";
import JSZip from "jszip";

const here = new URL(".", import.meta.url);
const { items } = JSON.parse(readFileSync(new URL("../../data/price_items.json", import.meta.url), "utf8"));
const ss = items.filter((i) => i.sheet_code === "SS");
const pick = ["Malarkey", "Roofing Nails", "Plastic Cap Nails"];
const bySection = pick.map((s) => [s, ss.filter((i) => i.section === s)]);
const money = (n) => `$${n.toFixed(2)}`;

const header = [
  "TEST_ONLY fixture generated from data/price_items.json",
  "BTR - Steep Slope",
  "Account: 2057372-2 BTR Contracting-Shop",
  "Sales Rep: Michael Poe",
  "Effective Date: 5/19/2026",
  "Expiration Date: 12/31/2026",
];

// ZIP container of .txt pages. Rows alternate between one-line and one-field-per-line layouts,
// and every third description wraps, to cover both shapes the parser accepts.
const pages = [header.join("\n")];
let n = 0;
bySection.forEach(([section, rows], si) => {
  const lines = [`${si + 1}. ${section}`];
  for (const r of rows) {
    const price = r.price_status === "LISTED" ? money(r.unit_price) : "CALL";
    const words = r.description.split(" ");
    const desc = n % 3 === 2 && words.length > 2 ? [words.slice(0, 2).join(" "), words.slice(2).join(" ")] : [r.description];
    if (n % 2 === 0) lines.push(`${r.item_number} ${desc.join("\n")} ${price} ${r.uom}`);
    else lines.push(r.item_number, ...desc, price, r.uom);
    n++;
  }
  pages.push(lines.join("\n"));
});
const zip = new JSZip();
pages.forEach((p, i) => zip.file(`page${i + 1}.txt`, p));
writeFileSync(new URL("TEST_ONLY_steep_slope_zip.pdf", here), await zip.generateAsync({ type: "nodebuffer" }));

// Table-style PDF, where a long description wraps inside its cell.
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const html = `<html><body style="font:11px Arial">${header.map((h) => `<div>${esc(h)}</div>`).join("")}
<table style="border-collapse:collapse;margin-top:12px;table-layout:fixed;width:560px">${bySection
  .map(
    ([section, rows], si) =>
      `<tr><td colspan=4 style="padding-top:8px;font-weight:bold">${si + 1}. ${esc(section)}</td></tr>` +
      rows
        .map(
          (r) =>
            `<tr style="vertical-align:top"><td style="width:110px">${r.item_number}</td><td style="width:${
              ["02MLVIA3AB", "15MIRN134P"].includes(r.item_number) ? 70 : 260
            }px">${esc(r.description)}</td><td style="width:70px;text-align:right">${
              r.price_status === "LISTED" ? money(r.unit_price) : "CALL"
            }</td><td style="padding-left:10px">${r.uom}</td></tr>`,
        )
        .join(""),
  )
  .join("")}</table><div style="margin-top:20px">Page 1 of 1</div></body></html>`;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html);
writeFileSync(new URL("TEST_ONLY_steep_slope.pdf", here), await page.pdf({ format: "Letter" }));
await browser.close();
console.log(`Wrote fixtures with ${bySection.reduce((a, [, r]) => a + r.length, 0)} rows`);
