// Builder plan books: a builder's master sheet (e.g. "Master Sheet - DR Horton Kansas City") read into
// models → elevations / options → per trade: what to order, the sell, the crew payout and BTR's profit.
// The sheet's own computed numbers are kept as-is (they're what BTR bills and pays); quantities are kept so
// the ordering sheet comes straight from the plan. Nothing is invented: a blank on the sheet stays blank.
import type { Tab } from "@/lib/import/xlsx";

export type Trade = "ROOFING" | "GUTTERS";
export type Mat = { name: string; qty: number; cost: number | null };
export type Kind = "ELEVATION" | "GARAGE" | "PORCH" | "OTHER";
export type PlanOption = {
  label: string;
  kind: Kind;
  onlyWith: string | null; // "3 Car (F Only)" → "F"
  materials: Mat[];
  materialCost: number | null; // materials before tax (roofing) / all-in sub cost (gutters)
  tax: number | null;
  squares: number | null; // roofing labor squares
  payout: number | null; // what the crew / sub is paid
  sell: number | null; // what the builder is billed
  profit: number | null; // sell − materials − tax − payout
};
export type Plan = { name: string; sqft: number | null; roofing: PlanOption[]; gutters: PlanOption[]; oldRoofing: Record<string, { sell?: number; payout?: number }> };
export type Rates = {
  roofing: { taxPct: number | null; markupPct: number | null; laborPerSq: number | null; laborMarkupPerSq: number | null; bootTrip: number | null; bootTripMarkup: number | null; fuelSurcharge: number | null; catalog: { name: string; cost: number | null }[] };
  gutters: { catalog: { name: string; cost: number | null; markup: number | null }[]; dlwoDownspoutLf: number | null; dlwoPrice: number | null };
  siding: { catalog: string[]; priced: boolean };
};
export type TakeoffEdit = { plan: string; trade: Trade; option: string; by: string; at: string; changes: string[] };
export type PlanBookData = { version: 1; plans: Plan[]; rates: Rates; warnings: string[]; edits?: TakeoffEdit[] };

const num = (s: string | undefined | null) => {
  if (s == null) return null;
  const t = String(s).replace(/[$,\s]/g, "");
  if (!t || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const cell = (g: string[][], r: number, c: number) => (g[r]?.[c] ?? "").trim();

export function optionKind(label: string): { kind: Kind; onlyWith: string | null } {
  const only = label.match(/\(\s*([A-Z])\s+only\s*\)/i)?.[1]?.toUpperCase() ?? null;
  if (/3\s*car/i.test(label)) return { kind: "GARAGE", onlyWith: only };
  if (/porch|deck|patio/i.test(label)) return { kind: "PORCH", onlyWith: only };
  if (/^[A-Z]$/.test(label.trim()) || /^(left|middle|right|end|center)\b/i.test(label.trim())) return { kind: "ELEVATION", onlyWith: null };
  return { kind: "OTHER", onlyWith: only };
}

/** Every "Model Type" block on a master tab: model name, option label, material rows and the totals below. */
function blocks(g: string[][], trade: Trade) {
  const out: { model: string; opt: PlanOption }[] = [];
  for (let r = 0; r < g.length; r++) {
    const row = g[r] ?? [];
    for (let k = 0; k < row.length; k++) {
      if ((row[k] ?? "").trim() !== "Model Type") continue;
      const model = cell(g, r + 1, k);
      const label = cell(g, r + 1, k + 2);
      if (!model || !label) continue;
      const materials: Mat[] = [];
      const costs: number[] = [];
      const profits: number[] = [];
      let tax: number | null = null;
      let squares: number | null = null;
      let payout: number | null = null;
      let sell: number | null = null;
      let total: number | null = null;
      for (let i = r + 2; i < Math.min(g.length, r + 45); i++) {
        const a = cell(g, i, k);
        const lab = cell(g, i, k + 1);
        const mat = cell(g, i, k + 2);
        if (a === "Model Type") break;
        if (/^Cost \(per/i.test(lab)) costs.push(num(cell(g, i, k + 3)) ?? 0);
        else if (/^Tax \(per/i.test(lab)) tax ??= num(cell(g, i, k + 3));
        else if (/^Profit\s+\(per/i.test(lab)) profits.push(num(cell(g, i, k + 3)) ?? 0);
        else if (/^Profit\s+\(per/i.test(a)) total = num(cell(g, i, k + 3));
        else if (/^Payout/i.test(a)) payout = num(cell(g, i, k + 3));
        else if (/^Overall/i.test(a)) {
          sell = num(cell(g, i, k + 3));
          break;
        } else if (/^Asphalt \(SQ\)/i.test(mat)) squares = num(cell(g, i, k + 3));
        else if (mat && !costs.length && num(cell(g, i, k + 3))) materials.push({ name: mat, qty: num(cell(g, i, k + 3))!, cost: num(cell(g, i, k + 4)) });
      }
      const materialCost = costs[0] ?? null;
      // roofing: the 2nd cost block is labor; profit = material profit + labor profit. Gutters: profit = markup.
      const profit = total ?? (profits.length ? r2(profits.reduce((x, y) => x + y, 0)) : sell != null && payout != null ? r2(sell - payout) : null);
      out.push({ model, opt: { label, ...optionKind(label), materials, materialCost, tax: trade === "ROOFING" ? tax : null, squares, payout, sell, profit } });
    }
  }
  return out;
}

const labelValue = (g: string[][], text: RegExp, dr = 1, dc = 0) => {
  for (let r = 0; r < Math.min(g.length, 40); r++)
    for (let c = 0; c < (g[r]?.length ?? 0); c++) if (text.test(cell(g, r, c))) return num(cell(g, r + dr, c + dc));
  return null;
};
/** The "Material | Cost" price list at the top of a master tab. */
function catalog(g: string[][]) {
  for (let r = 0; r < Math.min(g.length, 15); r++)
    for (let c = 0; c < (g[r]?.length ?? 0); c++)
      if (cell(g, r, c) === "Material" && /^Cost/.test(cell(g, r, c + 1))) {
        const items: { name: string; cost: number | null; markup: number | null }[] = [];
        for (let i = r + 1; i < g.length && cell(g, i, c); i++) items.push({ name: cell(g, i, c), cost: num(cell(g, i, c + 1)), markup: num(cell(g, i, c + 2)) });
        return items;
      }
  return [];
}

const norm = (s: string) => s.toLowerCase().replace(/\(\d+\)/g, "").replace(/[^a-z0-9]/g, "");
function close(a: string, b: string) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 2) return false;
  // ≤2 edits (the pricing tabs spell "Azaela" for "Azalea", "4PLex" for "4 Plex")
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length] <= 2;
}
export const findPlan = <T extends { name: string }>(plans: T[], name: string) => plans.find((p) => norm(p.name) === norm(name)) ?? plans.find((p) => close(norm(p.name), norm(name)));

export function parsePlanBook(tabs: Tab[]): PlanBookData {
  const warnings: string[] = [];
  const tab = (re: RegExp) => tabs.find((t) => re.test(t.name.trim()));
  const roofTab = tab(/^master sheet asphalt/i) ?? tab(/asphalt/i);
  const gutTab = tab(/^master gutter/i);
  const vinyl = tab(/^master vinyl/i);
  const hardie = tab(/^master hardie/i);
  if (!roofTab && !gutTab) throw new Error("Couldn't find the master roofing (\"Master Sheet Asphalt\") or gutter (\"Master Gutter Sheet\") tab in that workbook.");
  const plans: Plan[] = [];
  const planFor = (name: string) => {
    let p = plans.find((x) => x.name === name.trim());
    if (!p) plans.push((p = { name: name.trim(), sqft: null, roofing: [], gutters: [], oldRoofing: {} }));
    return p;
  };
  const add = (list: PlanOption[], o: PlanOption) => {
    let label = o.label;
    for (let n = 2; list.some((x) => x.label === label); n++) label = `${o.label} (${n})`;
    list.push({ ...o, label });
  };
  if (roofTab) for (const b of blocks(roofTab.rows, "ROOFING")) add(planFor(b.model).roofing, b.opt);
  if (gutTab) for (const b of blocks(gutTab.rows, "GUTTERS")) add(findPlan(plans, b.model)?.gutters ?? planFor(b.model).gutters, b.opt);

  const rg = roofTab?.rows ?? [];
  const gg = gutTab?.rows ?? [];
  const rates: Rates = {
    roofing: {
      taxPct: labelValue(rg, /^Master Tax Rate/i),
      markupPct: labelValue(rg, /^Master Mark Up/i),
      laborPerSq: labelValue(rg, /^Asphalt Shingles \(SQ\)/i, 0, 2),
      laborMarkupPerSq: labelValue(rg, /^Asphalt Shingles \(SQ\)/i, 0, 3),
      bootTrip: labelValue(rg, /^Boot Trip Charge/i, 0, 2),
      bootTripMarkup: labelValue(rg, /^Boot Trip Charge/i, 0, 3),
      fuelSurcharge: labelValue(rg, /^Fuel Surcharge/i),
      catalog: catalog(rg).map(({ name, cost }) => ({ name, cost })),
    },
    gutters: { catalog: catalog(gg), dlwoDownspoutLf: labelValue(gg, /^WO\/DL Options/i, 1, 1), dlwoPrice: labelValue(gg, /^WO\/DL Options/i, 1, 2) },
    siding: { catalog: vinyl ? catalog(vinyl.rows).map((x) => x.name) : [], priced: false },
  };
  if (vinyl) {
    const priced = catalog(vinyl.rows).some((x) => x.cost != null);
    rates.siding.priced = priced;
    if (!priced) warnings.push("Vinyl siding: the material list is on the sheet, but no prices or model quantities yet — siding isn't priced here until the sheet has them.");
  }
  if (hardie && hardie.rows.flat().filter((x) => x?.trim()).length < 10) warnings.push("Hardie siding tab is empty on the sheet.");

  // square footage from any pricing tab's plan names, e.g. "Aspen(1500)"
  for (const t of tabs)
    for (const row of t.rows) {
      const m = (row?.[0] ?? "").match(/^(.+?)\s*\((\d{3,5})\)\s*$/);
      if (!m) continue;
      const p = findPlan(plans, m[1]);
      if (p && !p.sqft) p.sqft = Number(m[2]);
    }

  // old roofing price grid ("Old Pricing"): elevation × rear porch × 3-car combos, sell and payout sections
  const old = tabs.find((t) => /^old pricing$/i.test(t.name.trim()));
  if (old) {
    let section: "sell" | "payout" = "sell";
    let head: string[] = [];
    for (const row of old.rows) {
      const a = (row?.[0] ?? "").trim();
      if (/payout/i.test(a)) section = "payout";
      else if (/sell/i.test(a)) section = "sell";
      if (a === "PLANS") {
        head = row.map((x) => (x ?? "").trim());
        continue;
      }
      if (!a || !head.length) continue;
      const p = findPlan(plans, a);
      if (!p) continue;
      head.forEach((h, c) => {
        const v = num(row[c]);
        if (c === 0 || !h || v == null) return;
        (p.oldRoofing[h] ??= {})[section] = v;
      });
    }
  }

  for (const p of plans) {
    if (!p.roofing.some((o) => o.sell)) warnings.push(`${p.name}: no roofing prices on the sheet.`);
    for (const o of p.roofing) if (o.kind !== "ELEVATION" && o.sell === 0) warnings.push(`${p.name} roofing “${o.label}” is $0 on the sheet.`);
  }
  if (!plans.length) throw new Error("No models found. The master tabs need the “Model Type” blocks.");
  return { version: 1, plans, rates, warnings };
}

// ---------- pick a model ----------
export type Selection = { elevation: string; garage: "2" | "3"; basement: "STANDARD" | "DLWO"; porch: boolean };
export type TradeOut = { picked: PlanOption[]; materials: Mat[]; sell: number; payout: number; materials$: number; profit: number; missing: string[] };

function pick(list: PlanOption[], sel: Selection) {
  const missing: string[] = [];
  const picked: PlanOption[] = [];
  const elev = list.find((o) => o.kind === "ELEVATION" && o.label === sel.elevation);
  if (elev) picked.push(elev);
  else if (list.length) missing.push(`Elevation ${sel.elevation} isn't on the sheet`);
  if (sel.garage === "3") {
    const g = list.find((o) => o.kind === "GARAGE" && o.onlyWith === sel.elevation) ?? list.find((o) => o.kind === "GARAGE" && !o.onlyWith);
    if (g) picked.push(g);
    else if (list.length) missing.push("3-car garage isn't priced for this model");
  }
  if (sel.porch) {
    const p = list.find((o) => o.kind === "PORCH");
    if (p) picked.push(p);
    else if (list.length) missing.push("Rear porch isn't priced for this model");
  }
  return { picked, missing };
}

function sumTrade(picked: PlanOption[], missing: string[], extra?: { sell: number; payout: number; mats: Mat[] }): TradeOut {
  const mats = new Map<string, Mat>();
  for (const m of [...picked.flatMap((o) => o.materials), ...(extra?.mats ?? [])]) {
    const cur = mats.get(m.name);
    mats.set(m.name, { name: m.name, qty: r2((cur?.qty ?? 0) + m.qty), cost: m.cost == null && cur?.cost == null ? null : r2((cur?.cost ?? 0) + (m.cost ?? 0)) });
  }
  const sell = r2(picked.reduce((a, o) => a + (o.sell ?? 0), 0) + (extra?.sell ?? 0));
  const payout = r2(picked.reduce((a, o) => a + (o.payout ?? 0), 0) + (extra?.payout ?? 0));
  const profit = r2(picked.reduce((a, o) => a + (o.profit ?? 0), 0));
  return { picked, materials: [...mats.values()].filter((m) => m.qty), sell, payout, profit, materials$: r2(sell - payout - profit), missing };
}

/** What one house costs out to: ordering sheet, sell, payout and profit per trade. */
export function buildOut(data: PlanBookData, plan: Plan, sel: Selection) {
  const roof = pick(plan.roofing, sel);
  const gut = pick(plan.gutters, sel);
  const dl = sel.basement === "DLWO" && data.rates.gutters.dlwoPrice != null ? { sell: data.rates.gutters.dlwoPrice, payout: data.rates.gutters.dlwoPrice, mats: data.rates.gutters.dlwoDownspoutLf ? [{ name: "Downspouts", qty: data.rates.gutters.dlwoDownspoutLf, cost: null }] : [] } : undefined;
  const roofing = sumTrade(roof.picked, roof.missing);
  const gutters = sumTrade(gut.picked, gut.missing, dl);
  const oldKey = `${sel.elevation}${sel.garage === "3" ? " 3 Car" : ""}${sel.porch ? " Rear Porch" : ""}`;
  const old = plan.oldRoofing[oldKey];
  const sell = r2(roofing.sell + gutters.sell);
  const profit = r2(roofing.profit + gutters.profit);
  return { roofing, gutters, total: { sell, payout: r2(roofing.payout + gutters.payout), profit, marginPct: sell ? r2((profit / sell) * 100) : null }, oldRoofing: old ? { key: oldKey, ...old } : null, dlwoNote: dl ? `Daylight / walkout basement: +${dl.mats[0]?.qty ?? 0} LF downspouts, +$${dl.sell} sell and +$${dl.payout} payout (as the sheet does it)` : null };
}

export const modelLabel = (plan: string, sel: Selection) => [plan, `Elev ${sel.elevation}`, sel.garage === "3" ? "3 Car" : null, sel.porch ? "Rear Porch" : null, sel.basement === "DLWO" ? "DL/WO" : null].filter(Boolean).join(" · ");

// ---------- profit audit ----------
export type AuditRow = { plan: string; sqft: number | null; label: string; kind: Kind; trade: Trade; sell: number; payout: number; materials: number; profit: number; marginPct: number | null; squares: number | null; oldSell: number | null };

export function auditRows(data: PlanBookData): AuditRow[] {
  const rows: AuditRow[] = [];
  for (const p of data.plans)
    for (const [trade, list] of [["ROOFING", p.roofing], ["GUTTERS", p.gutters]] as const)
      for (const o of list) {
        if (!o.sell) continue; // unpriced on the sheet (e.g. a model with no gutter price) — reported as a warning, not a 0% build
        const profit = o.profit ?? r2(o.sell - (o.payout ?? 0) - (o.materialCost ?? 0) - (o.tax ?? 0));
        rows.push({ plan: p.name, sqft: p.sqft, label: o.label, kind: o.kind, trade, sell: r2(o.sell), payout: r2(o.payout ?? 0), materials: r2(o.sell - (o.payout ?? 0) - profit), profit: r2(profit), marginPct: o.sell ? r2((profit / o.sell) * 100) : null, squares: o.squares, oldSell: trade === "ROOFING" && o.kind === "ELEVATION" ? (p.oldRoofing[o.label]?.sell ?? null) : null });
      }
  return rows;
}

/** Where the plan book leaves money on the table, from the sheet's own numbers. Each finding is a $ per house. */
export function moneyFindings(data: PlanBookData, housesPerYear: number | null) {
  const rows = auditRows(data);
  const base = rows.filter((r) => r.kind === "ELEVATION");
  const roof = base.filter((r) => r.trade === "ROOFING");
  const gut = base.filter((r) => r.trade === "GUTTERS");
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const avgSq = avg(roof.map((r) => r.squares ?? 0).filter(Boolean));
  const avgRoofMat = avg(
    data.plans.flatMap((p) => p.roofing.filter((o) => o.kind === "ELEVATION" && o.materialCost != null).map((o) => o.materialCost!)),
  );
  const R = data.rates.roofing;
  const f: { title: string; perHouse: number | null; detail: string }[] = [];
  if (R.fuelSurcharge)
    f.push({ title: `Fuel surcharge ($${R.fuelSurcharge}) isn't in any price`, perHouse: R.fuelSurcharge, detail: `The sheet lists a $${R.fuelSurcharge} fuel surcharge “on every job”, but no sell total includes it.` });
  if (R.bootTrip && !R.bootTripMarkup)
    f.push({ title: `Boot trip ($${R.bootTrip}) is billed at cost`, perHouse: null, detail: `Every roof carries a $${R.bootTrip} boot trip with no markup. A 15% markup would add $${r2(R.bootTrip * 0.15)} per house.` });
  if (R.laborMarkupPerSq != null && avgSq)
    f.push({ title: `Roofing labor markup is $${R.laborMarkupPerSq}/SQ`, perHouse: r2(avgSq), detail: `An average house is ${r2(avgSq)} SQ, so each extra $1/SQ of labor markup adds about $${r2(avgSq)} per house.` });
  if (R.markupPct != null && avgRoofMat)
    f.push({ title: `Roofing materials are marked up ${r2(R.markupPct * 100)}%`, perHouse: r2(avgRoofMat * 0.01), detail: `Average roofing materials are $${r2(avgRoofMat)} per house; each extra 1% of material markup adds about $${r2(avgRoofMat * 0.01)}.` });
  const dl = data.rates.gutters.dlwoPrice;
  if (dl) f.push({ title: "Daylight / walkout gutter add has no margin", perHouse: null, detail: `The sheet adds $${dl} to the sell and the same $${dl} to the payout, so BTR makes $0 on it.` });
  const oldDiff = roof.filter((r) => r.oldSell != null).map((r) => r.oldSell! - r.sell);
  if (oldDiff.length) {
    const lower = oldDiff.filter((d) => d > 0.5);
    f.push({ title: `Current roofing prices vs. the Old Pricing tab`, perHouse: r2(avg(oldDiff)), detail: `${lower.length} of ${oldDiff.length} elevations are cheaper on the new pricing than on the Old Pricing tab (average $${r2(avg(oldDiff))} per house lower). The sheet's order tab (“Interface”) still reads the old prices — confirm which one the builder is being billed.` });
  }
  const unpriced = data.plans.filter((p) => !p.roofing.some((o) => o.sell));
  if (unpriced.length) f.push({ title: "Models with no roofing price", perHouse: null, detail: `${unpriced.map((p) => p.name).join(", ")} — nothing to bill from the sheet.` });
  const roofMargin = roof.length ? r2(avg(roof.map((r) => r.marginPct ?? 0))) : null;
  const gutMargin = gut.length ? r2(avg(gut.map((r) => r.marginPct ?? 0))) : null;
  const perHouse = roof.length ? r2(avg(roof.map((r) => r.profit)) + avg(gut.map((r) => r.profit))) : null;
  return { findings: f.map((x) => ({ ...x, perYear: x.perHouse != null && housesPerYear ? Math.round(x.perHouse * housesPerYear) : null })), roofMargin, gutMargin, perHouse, avgSq: r2(avgSq), lowest: [...base].sort((a, b) => (a.marginPct ?? 0) - (b.marginPct ?? 0)).slice(0, 8) };
}

// ---------- edit a takeoff in BTRpro ----------
// Only the change is re-priced, with the sheet's own rates, so whatever the sheet carried that isn't on the material
// list (e.g. an extra labor line) stays. Roofing: material cost × (1 + tax + markup) and squares × (labor + labor
// markup) into sell; squares × labor into payout. Gutters: each LF line at its own $/LF cost into payout and
// cost + markup into sell. A line with no price (elbows, a new item not on the sheet's catalog) changes the order only.
export type LineEdit = { name: string; qty: number };

const unitOf = (m: Mat) => (m.cost != null && m.qty ? m.cost / m.qty : null);

export function editOption(data: PlanBookData, trade: Trade, opt: PlanOption, lines: LineEdit[], squares: number | null) {
  const changes: string[] = [];
  const unpriced: string[] = [];
  const old = new Map(opt.materials.map((m) => [m.name, m]));
  const roofCat = new Map(data.rates.roofing.catalog.map((c) => [c.name.toLowerCase(), c.cost]));
  const gutCat = data.rates.gutters.catalog;
  const marks = [...new Set(gutCat.map((c) => c.markup).filter((x): x is number => x != null))];
  const gutMarkup = (name: string) => gutCat.find((c) => c.name.toLowerCase() === name.toLowerCase())?.markup ?? (marks.length === 1 ? marks[0] : null);
  const seen = new Set<string>();
  const materials: Mat[] = [];
  let dCost = 0;
  let dSell = 0;
  let dPayout = 0;
  let dProfit = 0;
  for (const l of lines) {
    const name = l.name.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const qty = r2(l.qty);
    if (!(qty >= 0)) continue;
    const was = old.get(name);
    let unit = was ? unitOf(was) : null;
    if (unit == null && trade === "ROOFING") unit = roofCat.get(name.toLowerCase()) ?? null;
    if (unit == null && trade === "GUTTERS") unit = gutCat.find((c) => c.name.toLowerCase() === name.toLowerCase())?.cost ?? null;
    const dq = qty - (was?.qty ?? 0);
    if (dq) changes.push(`${name}: ${was?.qty ?? 0} → ${qty}`);
    if (dq && unit == null && (was?.cost ?? null) == null && !was) unpriced.push(name);
    if (dq && unit != null) {
      const dc = dq * unit;
      dCost += dc;
      if (trade === "GUTTERS") {
        const mk = gutMarkup(name) ?? 0;
        dPayout += dc;
        dSell += dc + dq * mk;
        dProfit += dq * mk;
      }
    }
    if (qty > 0) materials.push({ name, qty, cost: unit != null ? r2(unit * qty) : (was?.cost ?? null) });
  }
  for (const m of opt.materials) if (!seen.has(m.name.toLowerCase())) {
    changes.push(`${m.name}: removed`);
    const u = unitOf(m);
    if (u != null) {
      dCost -= m.cost!;
      if (trade === "GUTTERS") {
        const mk = gutMarkup(m.name) ?? 0;
        dPayout -= m.cost!;
        dSell -= m.cost! + m.qty * mk;
        dProfit -= m.qty * mk;
      }
    }
  }
  const next: PlanOption = { ...opt, materials };
  if (trade === "ROOFING") {
    const R = data.rates.roofing;
    // the sheet's squares can be 3.6666…; the page shows 2 decimals, so a sub-0.01 difference is no change
    const raw = squares != null ? squares - (opt.squares ?? 0) : 0;
    const dSq = Math.abs(raw) < 0.01 ? 0 : raw;
    if (dSq) changes.push(`Squares: ${opt.squares ?? 0} → ${squares}`);
    if ((dCost || dSq) && (R.taxPct == null || R.markupPct == null || R.laborPerSq == null || R.laborMarkupPerSq == null))
      throw new Error("The plan book has no roofing tax / markup / labor rates, so an edit can't be re-priced. Re-import the sheet with its rate table.");
    if (dSq) next.squares = squares;
    if (dCost || dSq) {
      next.materialCost = r2((opt.materialCost ?? 0) + dCost);
      next.tax = r2((opt.tax ?? 0) + dCost * R.taxPct!);
      next.sell = r2((opt.sell ?? 0) + dCost * (1 + R.taxPct! + R.markupPct!) + dSq * (R.laborPerSq! + R.laborMarkupPerSq!));
      next.payout = r2((opt.payout ?? 0) + dSq * R.laborPerSq!);
      next.profit = r2((opt.profit ?? 0) + dCost * R.markupPct! + dSq * R.laborMarkupPerSq!);
    }
  } else if (dCost || dSell) {
    next.materialCost = r2((opt.materialCost ?? 0) + dCost);
    next.sell = r2((opt.sell ?? 0) + dSell);
    next.payout = r2((opt.payout ?? 0) + dPayout);
    next.profit = r2((opt.profit ?? 0) + dProfit);
  }
  if (opt.sell != null && next.sell !== opt.sell) changes.push(`Sell ${opt.sell} → ${next.sell}, payout ${opt.payout} → ${next.payout}`);
  return { option: next, changes, unpriced };
}
