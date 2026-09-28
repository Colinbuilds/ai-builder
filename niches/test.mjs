// Checks every calculator against hand-worked numbers and that pages are up to date.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { NICHES } from "./niches.mjs";
import { renderPage } from "./build.mjs";

const { CALCS } = createRequire(import.meta.url)("../site/assets/calculators.js");
const defaults = (id) => Object.fromEntries(CALCS[id].inputs.map((f) => [f.id, f.value]));
const out = (id, v = {}) => {
  const r = CALCS[id].compute({ ...defaults(id), ...v });
  return Object.fromEntries(r.outputs.map((o) => [o.label, o.value]));
};

test("unsold quotes", () => {
  const o = out("unsold-quotes");
  assert.equal(o["Quotes that go unsold each month"], "28");
  assert.equal(o["Value of unsold quotes per month"], "$50,400");
  assert.equal(o["Extra revenue per year"], "$86,400");
  // target below current close rate never shows negative gains
  assert.equal(out("unsold-quotes", { target: 10 })["Extra revenue per year"], "$0");
});

test("cleaning price", () => {
  const o = out("cleaning-price");
  assert.equal(o["Good: Standard clean · 2.5 hrs on site"], "$240");
  assert.equal(o["Better: Deep clean · 3.8 hrs on site"], "$420");
  assert.equal(o["Best: Move-in / move-out · 4.6 hrs on site"], "$505");
});

test("freelance rate", () => {
  const o = out("freelance-rate");
  assert.equal(o["Minimum hourly rate"], "$100");
  assert.equal(o["You need to invoice per year"], "$114,667");
});

test("fundraise", () => {
  const o = out("raise-math");
  assert.equal(o["Post-money valuation"], "$9,500,000");
  assert.equal(o["Dilution from this round"], "15.8%");
  assert.equal(o["Runway after the raise"], "18.3 months");
  assert.equal(o["Investors to contact"], "750");
});

test("no-shows", () => {
  const o = out("no-show");
  assert.equal(o["Revenue lost to no-shows per year"], "$18,720");
  assert.equal(o["Total opportunity per year"], "$21,420");
});

test("retention", () => {
  const o = out("client-retention");
  assert.equal(o["Lifetime value per client today"], "$2,000");
  assert.equal(o["Extra lifetime value per new client"], "$1,333");
  assert.equal(o["Clients you'd keep per year"], "10");
});

test("rental cash flow", () => {
  const o = out("rental-cashflow");
  assert.equal(o["Cash flow per month"], "$216");
  assert.equal(o["Cap rate"], "5.8%");
  assert.equal(o["Cash-on-cash return"], "4.3%");
  assert.match(CALCS["rental-cashflow"].compute({ ...defaults("rental-cashflow"), rent: 1000 }).takeaway, /loses about/);
});

test("agent goal", () => {
  const o = out("agent-goal");
  assert.equal(o["You earn per closing"], "$7,000");
  assert.equal(o["Closings needed this year"], "20");
  assert.equal(o["Leads needed this year"], "667");
});

test("every niche has a calculator and a fresh page", () => {
  for (const n of NICHES) {
    assert.ok(CALCS[n.calc], n.slug + " calculator");
    const onDisk = readFileSync(new URL(`../site/${n.slug}/index.html`, import.meta.url), "utf8");
    assert.equal(onDisk, renderPage(n), n.slug + " page is out of date: run node niches/build.mjs");
  }
});
