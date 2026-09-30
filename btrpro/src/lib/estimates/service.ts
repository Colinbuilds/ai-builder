// Estimates: creation, waste gate, takeoff runs, lines, substitutions, revisions (BUILD_PROMPT §4–5).
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { priceStatusFor, estimateTotals, toSheetUnit, type SheetDateStatus } from "@/lib/calc/pricing";
import { cheapestHouseWrap } from "@/lib/calc/siding";
import { sheetDateStatus } from "@/lib/sheets/date-status";
import { parseScopes } from "@/lib/projects/intake";
import { refreshReadiness } from "@/lib/projects/service";
import { MEASUREMENT_BY_KEY } from "@/lib/docs/measurements";
import { defaultConfig, MODULES_FOR_SCOPE, runModule, type Ctx, type ItemInfo, type Module, type TakeoffConfig } from "./takeoff";

type Actor = { id: string; name: string; role?: string };
export type WasteSection = "ROOFING" | "SIDING" | "DECK";
export type WasteEntry = { pct: number | null; approved: boolean; approvedBy?: string | null; basis: string };
export type WasteMap = Record<WasteSection, WasteEntry>;
export type ScopeType = "STEEP" | "LOW_SLOPE" | "DECK" | "SIDING" | "PANELS" | "MIXED";

export class EstimateError extends Error {}

/** Reference ranges shown for approval only (CLAUDE.md §6). Nothing here is applied automatically. */
export const WASTE_REFERENCE: Record<WasteSection, string> = {
  ROOFING: "TPO/PVC 5% · EPDM 7% · standing seam 8–12% · residential shingle 5% (company default)",
  SIDING: "Fiber cement 10% · lap siding 10% · metal wall panels 5–10% · residential siding 5% (company default)",
  DECK: "No company default — enter and approve per job",
};

export function defaultWaste(market: string): WasteMap {
  const res = market === "RESIDENTIAL";
  const companyDefault = { pct: 5, approved: true, approvedBy: "Company default", basis: "Company residential default 5% (approved)" };
  const none = { pct: null, approved: false, basis: "Not set" };
  return { ROOFING: res ? companyDefault : none, SIDING: res ? companyDefault : none, DECK: none };
}

const wasteOf = (e: { wastePctBySection: unknown }): WasteMap => ({ ...defaultWaste("COMMERCIAL"), ...((e.wastePctBySection as WasteMap) ?? {}) });
export const wasteSectionsFor = (scope: ScopeType): WasteSection[] =>
  scope === "MIXED" ? ["ROOFING", "SIDING", "DECK"] : scope === "SIDING" || scope === "PANELS" ? ["SIDING"] : scope === "DECK" ? ["DECK"] : ["ROOFING"];
const allApproved = (w: WasteMap, scope: ScopeType) => wasteSectionsFor(scope).every((s) => w[s].pct != null && w[s].approved);

async function log(projectId: string, actor: Actor, text: string) {
  await prisma.projectActivity.create({ data: { projectId, userId: actor.id, kind: "estimate", text } });
}

export async function createEstimate(projectId: string, scopeType: ScopeType, actor: Actor) {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const last = await prisma.estimate.findFirst({ where: { projectId }, orderBy: { revision: "desc" } });
  const revision = (last?.revision ?? 0) + 1;
  const waste = defaultWaste(p.market);
  const takeoff: TakeoffConfig = {};
  for (const m of MODULES_FOR_SCOPE[scopeType]) (takeoff as Record<string, unknown>)[m] = defaultConfig(m, p.market);
  const e = await prisma.estimate.create({
    data: {
      projectId,
      name: `Rev ${revision}`,
      revision,
      scopeType,
      wastePctBySection: waste,
      wasteApproved: allApproved(waste, scopeType),
      takeoff: takeoff as Prisma.InputJsonValue,
      createdById: actor.id,
    },
  });
  if (last && !last.locked) await prisma.estimate.update({ where: { id: last.id }, data: { locked: true } });
  await log(projectId, actor, `${actor.name} started estimate ${e.name} (${scopeType.replace("_", " ").toLowerCase()})`);
  await refreshReadiness(projectId);
  return e;
}

function assertEditable(e: { locked: boolean; name: string }) {
  if (e.locked) throw new EstimateError(`${e.name} is locked. Create a new revision to change it.`);
}

export async function setWaste(estimateId: string, section: WasteSection, pct: number | null, approve: boolean, actor: Actor) {
  const e = await prisma.estimate.findUniqueOrThrow({ where: { id: estimateId }, include: { project: true } });
  assertEditable(e);
  if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 50)) throw new EstimateError("Waste must be between 0% and 50%.");
  const res = e.project.market === "RESIDENTIAL" && section !== "DECK";
  if (approve && res && pct !== 5 && actor.role !== "ADMIN")
    throw new EstimateError("Residential waste other than the 5% company default needs an Admin's approval (CLAUDE.md §6).");
  const w = wasteOf(e);
  w[section] = {
    pct,
    approved: approve && pct != null,
    approvedBy: approve && pct != null ? actor.name : null,
    basis: approve && pct != null ? (res && pct === 5 ? "Company residential default 5% (approved)" : `Approved by ${actor.name}`) : "Not approved — reference only",
  };
  await prisma.estimate.update({ where: { id: estimateId }, data: { wastePctBySection: w, wasteApproved: allApproved(w, e.scopeType) } });
  if (approve)
    await prisma.auditLog.create({ data: { userId: actor.id, entity: "Estimate", entityId: estimateId, action: "approve_waste", after: { section, pct } } });
  await log(e.projectId, actor, `${actor.name} set ${section.toLowerCase()} waste to ${pct ?? "—"}%${approve ? " (approved)" : " (not approved)"}`);
  await refreshReadiness(e.projectId);
}

export async function saveTakeoff(estimateId: string, module: Module, config: unknown) {
  const e = await prisma.estimate.findUniqueOrThrow({ where: { id: estimateId } });
  assertEditable(e);
  const cur = (e.takeoff as TakeoffConfig) ?? {};
  await prisma.estimate.update({ where: { id: estimateId }, data: { takeoff: { ...cur, [module]: config } as Prisma.InputJsonValue } });
}

/** Confirmed / user-entered measurements, summed per key (per-facet keys like pitch are not summed). */
export async function measureMap(projectId: string) {
  const ms = await prisma.measurement.findMany({
    where: { projectId, status: { in: ["CONFIRMED", "USER_ENTERED"] } },
    include: { sourceDoc: { select: { fileName: true } } },
  });
  const map = new Map<string, { value: number; source: string }>();
  for (const m of ms) {
    if (m.value == null) continue;
    const def = MEASUREMENT_BY_KEY.get(m.key);
    if (def && "perFacet" in def && def.perFacet) continue;
    const src = m.sourceDoc ? `${m.sourceDoc.fileName} p.${m.sourcePage}` : (m.note ?? "entered");
    const cur = map.get(m.key);
    map.set(m.key, cur ? { value: cur.value + m.value, source: `${cur.source} + ${src}` } : { value: m.value, source: src });
  }
  return map;
}

export type LiveItem = ItemInfo & {
  id: string;
  unitPrice: number | null;
  priceStatus: "LISTED" | "CALL";
  uom: string;
  sheetStatus: SheetDateStatus;
  sheetWarning: string | null;
};

/** Looks up item numbers on the live sheets. */
export async function liveItems(itemNumbers: string[]): Promise<Map<string, LiveItem>> {
  const nums = [...new Set(itemNumbers.filter(Boolean))];
  if (!nums.length) return new Map();
  const rows = await prisma.priceItem.findMany({ where: { itemNumber: { in: nums }, sheet: { isActive: true } }, include: { sheet: true } });
  return new Map(
    rows.map((r) => [
      r.itemNumber,
      {
        id: r.id,
        itemNumber: r.itemNumber,
        description: r.description,
        sheetCode: r.sheet.code,
        coverageQty: r.coverageQty,
        coverageUnit: r.coverageUnit,
        unitPrice: r.unitPrice,
        priceStatus: r.priceStatus,
        uom: r.uom,
        sheetStatus: sheetDateStatus(r.sheet).status,
        sheetWarning: r.sheet.warning,
      },
    ]),
  );
}

/** SID-04: cheapest house wrap per SF of coverage on a sheet (by item description + parsed SF/RL coverage). */
export async function cheapestWrapOnSheet(sheetCode: string | null | undefined) {
  if (!sheetCode) return null;
  const rows = await prisma.priceItem.findMany({
    where: { sheet: { code: sheetCode, isActive: true }, description: { contains: "wrap" }, uom: "RL" },
    include: { sheet: true },
  });
  const pick = cheapestHouseWrap(
    rows
      .filter((r) => /wrap/i.test(r.description) && !/tape/i.test(r.description))
      .map((r) => ({ itemNumber: r.itemNumber, name: r.description, unitPrice: r.unitPrice, coverageSf: r.coverageUnit === "SF/RL" ? r.coverageQty : null, sheetCode: r.sheet.code })),
    sheetCode,
  );
  return pick?.itemNumber ?? null;
}

function collectItemNumbers(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => collectItemNumbers(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (k === "itemNumber" && typeof x === "string") out.push(x);
      else collectItemNumbers(x, out);
    }
  }
  return out;
}

export async function runTakeoff(estimateId: string, module: Module, actor: Actor) {
  const e = await prisma.estimate.findUniqueOrThrow({ where: { id: estimateId }, include: { project: true } });
  assertEditable(e);
  const config = ((e.takeoff as TakeoffConfig) ?? {}) as TakeoffConfig;
  if (!config[module]) (config as Record<string, unknown>)[module] = defaultConfig(module, e.project.market);
  if (module === "siding" && config.siding && config.siding.houseWrap.mode === "cheapest") {
    const plank = config.siding.plank.itemNumber ? (await liveItems([config.siding.plank.itemNumber])).get(config.siding.plank.itemNumber) : null;
    const wrap = await cheapestWrapOnSheet(plank?.sheetCode ?? config.siding.plank.sheetCode);
    config.siding.houseWrap.pick = { ...config.siding.houseWrap.pick, itemNumber: wrap, coverage: null };
  }
  const items = await liveItems([...collectItemNumbers(config[module]), "0150080011", "4292804534"]);
  const w = wasteOf(e);
  const asWaste = (s: WasteSection) => ({ pct: w[s].pct, approved: w[s].approved, basis: w[s].basis });
  const ctx: Ctx = { m: await measureMap(e.projectId), items, waste: { ROOFING: asWaste("ROOFING"), SIDING: asWaste("SIDING"), DECK: asWaste("DECK") } };
  const { lines, problems } = runModule(module, config, ctx);
  if (problems.length) throw new EstimateError(problems.join(" "));

  await prisma.estimateLine.deleteMany({ where: { estimateId, calcKey: { startsWith: `${module}:` } } });
  let order = (await prisma.estimateLine.aggregate({ where: { estimateId }, _max: { sortOrder: true } }))._max.sortOrder ?? 0;
  for (const l of lines) {
    const it = l.itemNumber ? items.get(l.itemNumber) : undefined;
    const conv = it ? toSheetUnit(l.quantity, l.unit, it) : { quantity: l.quantity, ok: true, formula: null, note: null };
    let priced =
      l.itemNumber === "N/A" ? { sourceStatus: "VERIFIED" as const, unitCost: null, total: 0 } : priceStatusFor(conv.quantity, it ?? null, l.itemNumber);
    if (!conv.ok) priced = { sourceStatus: "MISSING_PRICE", unitCost: it?.unitPrice ?? null, total: null };
    const status = l.missing.length && priced.sourceStatus !== "MISSING_ITEM" ? "MISSING" : priced.sourceStatus;
    await prisma.estimateLine.create({
      data: {
        estimateId,
        section: l.section,
        itemName: it?.description ?? l.itemName,
        priceItemId: it?.id ?? null,
        supplierItemNumber: l.itemNumber === "N/A" ? null : l.itemNumber,
        quantity: conv.quantity,
        unit: it && conv.ok ? it.uom : l.unit,
        unitCost: priced.unitCost,
        total: priced.total,
        formula: conv.formula ? `${l.formula} → ${conv.formula}` : l.formula,
        formulaInputs: l.inputs as Prisma.InputJsonValue,
        sourceStatus: status,
        ruleId: l.ruleId ?? null,
        calcKey: `${module}:${l.key}`,
        note: [l.note, conv.note].filter(Boolean).join(" ") || null,
        sortOrder: ++order,
      },
    });
  }
  await prisma.estimate.update({ where: { id: estimateId }, data: { takeoff: config as Prisma.InputJsonValue } });
  await log(e.projectId, actor, `${actor.name} ran the ${module} takeoff on ${e.name}: ${lines.length} lines, ${lines.filter((l) => l.missing.length).length} missing`);
  await refreshReadiness(e.projectId);
  return lines;
}

export type ManualLine = {
  section: "MATERIAL_ROOFING" | "MATERIAL_DECK" | "MATERIAL_SIDING" | "GENERAL_CONDITIONS";
  itemNumber?: string | null;
  itemName: string;
  quantity: number | null;
  unit: string | null;
  unitCost?: number | null;
  source?: string | null;
  placeholder?: boolean;
};

export async function addLine(estimateId: string, input: ManualLine, actor: Actor) {
  const e = await prisma.estimate.findUniqueOrThrow({ where: { id: estimateId } });
  assertEditable(e);
  if (input.quantity != null && (!Number.isFinite(input.quantity) || input.quantity < 0)) throw new EstimateError("Quantity must be a positive number.");
  let data: Prisma.EstimateLineUncheckedCreateInput;
  const base = { estimateId, section: input.section, quantity: input.quantity, sortOrder: 9999 };
  if (input.itemNumber) {
    const it = (await liveItems([input.itemNumber])).get(input.itemNumber.trim());
    const priced = priceStatusFor(input.quantity, it ?? null, input.itemNumber.trim());
    data = {
      ...base,
      itemName: it?.description ?? input.itemName,
      priceItemId: it?.id ?? null,
      supplierItemNumber: input.itemNumber.trim(),
      unit: it?.uom ?? input.unit,
      unitCost: priced.unitCost,
      total: priced.total,
      sourceStatus: priced.sourceStatus,
      formula: input.quantity != null ? `${input.quantity} entered by ${actor.name}` : null,
      note: it ? null : "Item number not on any loaded BTR sheet — request the correct sheet or substitute (requires approval).",
    };
  } else {
    if (!input.itemName.trim()) throw new EstimateError("Name the line.");
    const cost = input.unitCost ?? null;
    if (cost != null && !input.source?.trim()) throw new EstimateError("Say where the price came from (quote, vendor, historical job).");
    const status = cost == null ? "MISSING_PRICE" : input.placeholder ? "PLACEHOLDER" : "VERIFIED";
    data = {
      ...base,
      itemName: input.itemName.trim(),
      unit: input.unit,
      unitCost: cost,
      total: cost != null && input.quantity != null ? Math.round(cost * input.quantity * 100) / 100 : null,
      sourceStatus: input.quantity == null && cost != null ? "MISSING" : status,
      formula: input.quantity != null ? `${input.quantity} × ${cost ?? "?"} entered by ${actor.name}` : null,
      note: input.placeholder ? `PLACEHOLDER — NOT FOR FINAL BID. ${input.source ?? ""}`.trim() : input.source?.trim() ? `Priced from: ${input.source.trim()}` : null,
    };
  }
  const l = await prisma.estimateLine.create({ data });
  await log(e.projectId, actor, `${actor.name} added "${l.itemName}" to ${e.name}`);
  await refreshReadiness(e.projectId);
  return l;
}

export async function overrideQuantity(lineId: string, quantity: number, reason: string, actor: Actor) {
  const l = await prisma.estimateLine.findUniqueOrThrow({ where: { id: lineId }, include: { estimate: true } });
  assertEditable(l.estimate);
  if (!Number.isFinite(quantity) || quantity < 0) throw new EstimateError("Quantity must be a positive number.");
  if (!reason.trim()) throw new EstimateError("Say why the calculated quantity is being changed.");
  const it = l.supplierItemNumber ? (await liveItems([l.supplierItemNumber])).get(l.supplierItemNumber) : undefined;
  const priced = l.unitCost != null && !it ? { unitCost: l.unitCost, total: Math.round(l.unitCost * quantity * 100) / 100, sourceStatus: l.sourceStatus } : priceStatusFor(quantity, it ?? null, l.supplierItemNumber);
  await prisma.estimateLine.update({
    where: { id: lineId },
    data: {
      quantity,
      unitCost: priced.unitCost,
      total: priced.total,
      sourceStatus: priced.sourceStatus as never,
      formula: `${l.formula ?? ""} → overridden to ${quantity} by ${actor.name}: ${reason.trim()}`,
    },
  });
  await log(l.estimate.projectId, actor, `${actor.name} changed ${l.itemName} from ${l.quantity ?? "—"} to ${quantity} (${reason.trim()})`);
  await refreshReadiness(l.estimate.projectId);
}

/** Explicit, logged substitution — the only way to swap a spec'd product for another (CLAUDE.md §3.9). */
export async function substituteLine(lineId: string, itemNumber: string, reason: string, actor: Actor) {
  const l = await prisma.estimateLine.findUniqueOrThrow({ where: { id: lineId }, include: { estimate: true } });
  assertEditable(l.estimate);
  if (!reason.trim()) throw new EstimateError("A substitution needs a reason (who approved it and why).");
  const it = (await liveItems([itemNumber.trim()])).get(itemNumber.trim());
  if (!it) throw new EstimateError(`${itemNumber} isn't on any loaded sheet.`);
  const priced = priceStatusFor(l.quantity, it, it.itemNumber);
  await prisma.estimateLine.update({
    where: { id: lineId },
    data: {
      itemName: it.description,
      priceItemId: it.id,
      supplierItemNumber: it.itemNumber,
      unit: it.uom,
      unitCost: priced.unitCost,
      total: priced.total,
      sourceStatus: priced.sourceStatus,
      substitution: true,
      substitutionNote: `Substituted for ${l.supplierItemNumber ?? l.itemName} by ${actor.name}: ${reason.trim()}`,
    },
  });
  await prisma.auditLog.create({
    data: { userId: actor.id, entity: "EstimateLine", entityId: lineId, action: "substitute", before: { item: l.supplierItemNumber, name: l.itemName }, after: { item: it.itemNumber, reason } },
  });
  await log(l.estimate.projectId, actor, `${actor.name} substituted ${it.itemNumber} for ${l.supplierItemNumber ?? l.itemName} — ${reason.trim()}`);
  await refreshReadiness(l.estimate.projectId);
}

export async function deleteLine(lineId: string, actor: Actor) {
  const l = await prisma.estimateLine.findUniqueOrThrow({ where: { id: lineId }, include: { estimate: true } });
  assertEditable(l.estimate);
  await prisma.estimateLine.delete({ where: { id: lineId } });
  await log(l.estimate.projectId, actor, `${actor.name} removed "${l.itemName}" from ${l.estimate.name}`);
  await refreshReadiness(l.estimate.projectId);
}

export async function createRevision(estimateId: string, actor: Actor) {
  const e = await prisma.estimate.findUniqueOrThrow({ where: { id: estimateId }, include: { lines: true, laborLines: true, scopeItems: true, openItems: true } });
  const last = await prisma.estimate.findFirst({ where: { projectId: e.projectId }, orderBy: { revision: "desc" } });
  const revision = (last?.revision ?? e.revision) + 1;
  const copy = await prisma.estimate.create({
    data: {
      projectId: e.projectId,
      name: `Rev ${revision}`,
      revision,
      scopeType: e.scopeType,
      wastePctBySection: e.wastePctBySection ?? Prisma.JsonNull,
      wasteApproved: e.wasteApproved,
      contingencyPct: e.contingencyPct,
      notes: e.notes,
      takeoff: e.takeoff ?? Prisma.JsonNull,
      createdById: actor.id,
      lines: { create: e.lines.map(({ id: _i, estimateId: _e, formulaInputs, ...l }) => ({ ...l, formulaInputs: formulaInputs ?? Prisma.JsonNull })) },
      laborLines: { create: e.laborLines.map(({ id: _i, estimateId: _e, ...l }) => l) },
      scopeItems: { create: e.scopeItems.map(({ id: _i, estimateId: _e, ...s }) => s) },
    },
  });
  for (const o of e.openItems.filter((o) => !o.resolved))
    await prisma.openItem.create({ data: { projectId: o.projectId, estimateId: copy.id, text: o.text, owner: o.owner } });
  await prisma.estimate.updateMany({ where: { projectId: e.projectId, id: { not: copy.id } }, data: { locked: true } });
  await log(e.projectId, actor, `${actor.name} created ${copy.name} from ${e.name}`);
  await refreshReadiness(e.projectId);
  return copy;
}

export async function totalsFor(estimateId: string) {
  const e = await prisma.estimate.findUniqueOrThrow({ where: { id: estimateId }, include: { lines: true, laborLines: true } });
  return estimateTotals(
    e.lines.map((l) => ({ section: l.section, total: l.total, sourceStatus: l.sourceStatus })),
    e.laborLines.map((l) => ({ total: l.total, sourceStatus: l.sourceStatus })),
    e.contingencyPct,
  );
}

export type LineDiff = { key: string; name: string; change: "added" | "removed" | "changed"; before?: { qty: number | null; cost: number | null; total: number | null }; after?: { qty: number | null; cost: number | null; total: number | null } };

export async function diffEstimates(aId: string, bId: string) {
  const [a, b] = await Promise.all([
    prisma.estimate.findUniqueOrThrow({ where: { id: aId }, include: { lines: true } }),
    prisma.estimate.findUniqueOrThrow({ where: { id: bId }, include: { lines: true } }),
  ]);
  const key = (l: { calcKey: string | null; supplierItemNumber: string | null; itemName: string; section: string }) => l.calcKey ?? `${l.section}:${l.supplierItemNumber ?? l.itemName}`;
  const pick = (l: { quantity: number | null; unitCost: number | null; total: number | null }) => ({ qty: l.quantity, cost: l.unitCost, total: l.total });
  const am = new Map(a.lines.map((l) => [key(l), l]));
  const bm = new Map(b.lines.map((l) => [key(l), l]));
  const out: LineDiff[] = [];
  for (const [k, l] of bm) {
    const old = am.get(k);
    if (!old) out.push({ key: k, name: l.itemName, change: "added", after: pick(l) });
    else if (old.quantity !== l.quantity || old.unitCost !== l.unitCost || old.total !== l.total || old.supplierItemNumber !== l.supplierItemNumber)
      out.push({ key: k, name: l.itemName, change: "changed", before: pick(old), after: pick(l) });
  }
  for (const [k, l] of am) if (!bm.has(k)) out.push({ key: k, name: l.itemName, change: "removed", before: pick(l) });
  return { a, b, lines: out, totals: { a: await totalsFor(aId), b: await totalsFor(bId) } };
}

export const scopesOf = (p: { scopes: unknown }) => parseScopes(p.scopes);

/** A person accepts or rejects an AI-proposed line. Accepting re-checks it against the live sheets. */
export async function decideAiLine(lineId: string, accept: boolean, actor: Actor) {
  const l = await prisma.estimateLine.findUniqueOrThrow({ where: { id: lineId }, include: { estimate: true } });
  assertEditable(l.estimate);
  if (l.sourceStatus !== "PENDING_AI") throw new EstimateError("That line isn't an AI suggestion.");
  if (!accept) {
    await prisma.estimateLine.delete({ where: { id: lineId } });
    await log(l.estimate.projectId, actor, `${actor.name} rejected AI suggestion "${l.itemName}"`);
  } else {
    const it = l.supplierItemNumber ? (await liveItems([l.supplierItemNumber])).get(l.supplierItemNumber) : undefined;
    if (l.supplierItemNumber && !it) throw new EstimateError(`${l.supplierItemNumber} is no longer on a loaded sheet.`);
    if (it && l.unitCost != null && it.unitPrice !== l.unitCost) throw new EstimateError("The sheet price changed since the suggestion. Reject it and ask again.");
    const priced = it ? priceStatusFor(l.quantity, it, it.itemNumber) : { sourceStatus: "MISSING_PRICE" as const, unitCost: null, total: null };
    await prisma.estimateLine.update({
      where: { id: lineId },
      data: { sourceStatus: priced.sourceStatus, unitCost: priced.unitCost, total: priced.total, note: `${l.note ?? ""} · accepted by ${actor.name}`.trim() },
    });
    await log(l.estimate.projectId, actor, `${actor.name} accepted AI suggestion "${l.itemName}"`);
  }
  await refreshReadiness(l.estimate.projectId);
}
