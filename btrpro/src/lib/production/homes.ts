// Home Company Schedule: new-construction houses for home builders. A house is one address from the builder
// with its model and elevation; each scope picked (roofing, siding, gutters, roof seal, columns) is its own
// line on the production board, so crews, pay out, sell and billing work the same as every other line.
import type { ProdLine } from "@prisma/client";
import { prisma } from "@/lib/db";
import { activeBooks } from "@/lib/builders/planbook";
import { buildOut, findPlan, modelLabel, unitFor, type Selection } from "@/lib/builders/plans";
import { addProdLine, ProdError, stepProdLine } from "./board";
import { BASEMENTS } from "./house-text";

export const HOME_SCOPES = ["Roofing", "Siding", "Gutters", "Roof Seal", "Columns"] as const;
export type HomeScope = (typeof HOME_SCOPES)[number];
export const ADD_ONS = ["Covered Rear Deck", "Cantilevered Pantry", "In-Law Suite", "Ext Front Porch"] as const;
export type AddOn = (typeof ADD_ONS)[number];
export { BASEMENTS, type Basement } from "./house-text";

export const SCOPE_STATUS = { WAITING: "Waiting", IN_PROGRESS: "In progress", DONE: "Job Done", BILLING: "Sent to Billing" } as const;
export type ScopeStatus = keyof typeof SCOPE_STATUS;

/** Which of the five scopes a board line is ("Roofing L&M" is Roofing, "Siding Labor" is Siding); null for other work. */
export function scopeOf(type: string | null | undefined): HomeScope | null {
  const t = (type ?? "").toLowerCase();
  if (/seal/.test(t)) return "Roof Seal";
  if (/column/.test(t)) return "Columns";
  if (/gutter/.test(t)) return "Gutters";
  if (/siding/.test(t)) return "Siding";
  if (/roof/.test(t)) return "Roofing";
  return null;
}

/**
 * The status shown for a line, read from the same fields the main schedule uses so both pages always agree:
 * billed to the builder (or Sent to Billing here) → Sent to Billing; completed → Job Done; Current → In progress.
 */
export function statusOf(l: Pick<ProdLine, "scopeStatus" | "board" | "completed" | "billed" | "btrPaid">): ScopeStatus {
  if (l.billed || l.btrPaid) return "BILLING";
  if (l.completed) return l.scopeStatus === "BILLING" ? "BILLING" : "DONE";
  return l.board === "CURRENT" ? "IN_PROGRESS" : "WAITING";
}

/** Office people who bill the builder (Office role; admins if there are none). */
async function billers() {
  const office = await prisma.user.findMany({ where: { role: "OFFICE" }, select: { id: true } });
  return office.length ? office : prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
}

/**
 * Change one scope's status. In progress moves it to Current; Job Done marks it completed (the office gets the
 * "crew can be paid" task, same as the board's Completed button); Sent to Billing also gives the office a "bill it"
 * task. Moving back clears completed and closes those tasks. A scope already billed to the builder can't move back.
 */
export async function setScopeStatus(id: string, status: string, actor: Actor) {
  if (actor.role === "VIEWER") throw new ProdError("Viewers can't change the schedule.");
  if (!(status in SCOPE_STATUS)) throw new ProdError("Pick Waiting, In progress, Job Done or Sent to Billing.");
  const line = await prisma.prodLine.findUnique({ where: { id } });
  if (!line) throw new ProdError("That scope is no longer on the schedule.");
  const back = status === "WAITING" || status === "IN_PROGRESS";
  if (back && (line.billed || line.btrPaid)) throw new ProdError(`${line.type} at ${line.location} is already billed to the builder. Change it on the main schedule if that's wrong.`);
  const now = new Date();
  if (!back && !line.completed) await stepProdLine(id, "complete", actor);
  if (back) {
    await prisma.task.updateMany({ where: { auto: { in: [`PROD:pay:${id}`, `PROD:bill:${id}`] }, doneAt: null }, data: { doneAt: now, doneBy: `${actor.name} (moved back to ${SCOPE_STATUS[status as ScopeStatus]})` } });
  }
  if (status === "BILLING" && line.scopeStatus !== "BILLING") {
    const what = [line.builder, line.location, line.type].filter(Boolean).join(" · ");
    for (const u of await billers())
      await prisma.task.create({ data: { title: `Bill the builder: ${what}${line.sell != null ? ` — sell $${line.sell.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : ""}`, assigneeId: u.id, dueDate: now, projectId: line.projectId, auto: `PROD:bill:${id}`, createdBy: actor.name } });
  }
  if (status === "DONE") await prisma.task.updateMany({ where: { auto: `PROD:bill:${id}`, doneAt: null }, data: { doneAt: now, doneBy: `${actor.name} (moved back to Job Done)` } });
  return prisma.prodLine.update({
    where: { id },
    data: {
      scopeStatus: status,
      source: "APP",
      updatedBy: actor.name,
      ...(status === "IN_PROGRESS" ? { board: "CURRENT" } : {}),
      ...(status === "WAITING" && line.board === "CURRENT" ? { board: "UPCOMING" } : {}),
      ...(back ? { completed: null, completedAt: null } : {}),
    },
  });
}

export type HouseInput = {
  builder: string;
  address: string;
  model: string;
  elevation: string;
  scopes: string[];
  superName?: string | null;
  vpo?: string | null;
  startDate?: Date | null;
  notes?: string | null;
  basement?: string | null;
  addOns?: string[];
  elevationType?: string | null;
  houseInfo?: string | null;
  planUrl?: string | null;
  /** from the builder's work orders: per scope, its number, sell, options and the PDF */
  workOrders?: { scope: string; workOrder?: string | null; sell?: number | null; notes?: string | null; fileUrl?: string | null }[];
};

type Actor = { id: string; name: string; role: string };

const key = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
export const houseKey = (l: Pick<ProdLine, "builder" | "location">) => `${key(l.builder)}|${key(l.location)}`;

/** Open board lines (not completed) for this builder + address, matched loosely on spacing and punctuation. */
async function openLinesAt(builder: string, address: string) {
  const lines = await prisma.prodLine.findMany({ where: { market: "RESIDENTIAL", board: { not: "COMPLETED" }, location: { not: null } } });
  return lines.filter((l) => houseKey(l) === houseKey({ builder, location: address }));
}

/** Put a builder's house on the schedule: one "New — to be placed" line per scope picked. */
export async function createHouse(i: HouseInput, actor: Actor) {
  if (actor.role === "VIEWER") throw new ProdError("Viewers can't add jobs to the schedule.");
  const builder = i.builder.trim();
  const address = i.address.trim();
  const model = i.model.trim();
  const elevation = i.elevation.trim();
  const problems = [
    !builder && "Pick the builder.",
    !address && "Enter the address from the builder.",
    !model && "Enter the model.",
    !elevation && "Enter the elevation.",
  ].filter(Boolean) as string[];
  const scopes = HOME_SCOPES.filter((s) => i.scopes.includes(s));
  if (!scopes.length) problems.push("Pick at least one scope.");
  const addOns = ADD_ONS.filter((a) => i.addOns?.includes(a));
  const uploaded = (u: string | null | undefined) => !u || /^(local|s3):work-orders\/[\w.\- ]+$/.test(u);
  if (![i.planUrl, ...(i.workOrders ?? []).map((w) => w.fileUrl)].every(uploaded)) problems.push("A work order file isn't one uploaded here. Drop it again.");
  if (problems.length) throw new ProdError(problems.join(" "));

  const existing = await openLinesAt(builder, address);
  const already = new Set(existing.map((l) => scopeOf(l.type)));
  const dupes = scopes.filter((s) => already.has(s));
  if (dupes.length) throw new ProdError(`${address} already has ${dupes.join(", ")} on the schedule for ${builder}. Open that house to change it.`);

  // a scope added to a house already on the schedule keeps the house's details and plan set
  const house = existing.find((l) => l.basement || l.addOns || l.elevationType || l.houseInfo || l.planUrl);
  const keep = (v: string | null | undefined, from: string | null | undefined) => v || from || null;
  const basement = i.basement && i.basement in BASEMENTS ? i.basement : (house?.basement ?? "FULL_DIG");
  const fill = await planBookFill(builder, model, elevation, basement);
  const lines = [];
  for (const scope of scopes) {
    const f = scope === "Roofing" ? fill?.roofing : scope === "Gutters" ? fill?.gutters : null;
    const wo = i.workOrders?.find((w) => w.scope === scope);
    const woSell = wo?.sell != null && Number.isFinite(wo.sell) ? Math.round(wo.sell * 100) / 100 : null;
    const line = await addProdLine(
      {
        market: "RESIDENTIAL",
        board: "ADD",
        grp: builder,
        builder,
        location: address,
        model,
        elevation,
        type: scope,
        superName: i.superName ?? null,
        vpo: wo?.workOrder?.trim() || i.vpo || null,
        notes: [wo?.notes?.trim(), i.notes].filter(Boolean).join(" · ") || null,
        // the builder's work order is what they'll pay; the plan book's sell is the fallback
        sell: woSell ?? f?.sell ?? null,
        payout: f?.payout ?? null,
      },
      actor,
    );
    lines.push(
      await prisma.prodLine.update({
        where: { id: line.id },
        data: {
          basement,
          addOns: keep(addOns.join(", "), house?.addOns),
          elevationType: keep(i.elevationType?.trim(), house?.elevationType),
          houseInfo: keep(i.houseInfo?.trim(), house?.houseInfo),
          planUrl: keep(i.planUrl, house?.planUrl),
          workOrderUrl: wo?.fileUrl || null,
          ...(f ? { materials: f.materials, materialsSrc: f.src } : {}),
        },
      }),
    );
  }
  if (i.startDate) await prisma.prodLine.updateMany({ where: { id: { in: lines.map((l) => l.id) } }, data: { startDate: i.startDate } });
  return lines;
}

export type House = { key: string; builder: string; address: string; model: string | null; elevation: string | null; superName: string | null; start: Date | null; basement: string | null; addOns: string | null; elevationType: string | null; houseInfo: string | null; plan: string | null; lines: ProdLine[]; scopes: Partial<Record<HomeScope, ProdLine[]>>; other: ProdLine[] };

/** Open residential builder houses, one entry per address with its scope lines. */
export async function homeSchedule(builder?: string | null) {
  const lines = await prisma.prodLine.findMany({
    where: { market: "RESIDENTIAL", board: { in: ["ADD", "UPCOMING", "CURRENT"] }, location: { not: null }, builder: builder ? builder : { not: null } },
    orderBy: [{ startDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 3000,
  });
  const houses = new Map<string, House>();
  for (const l of lines) {
    const k = houseKey(l);
    const h = houses.get(k) ?? { key: k, builder: l.builder!, address: l.location!, model: null, elevation: null, superName: null, start: null, basement: null, addOns: null, elevationType: null, houseInfo: null, plan: null, lines: [], scopes: {}, other: [] };
    h.lines.push(l);
    const sc = scopeOf(l.type);
    if (sc) (h.scopes[sc] ??= []).push(l);
    else h.other.push(l);
    h.model ??= l.model;
    h.elevation ??= l.elevation;
    h.superName ??= l.superName;
    h.basement ??= l.basement;
    h.addOns ??= l.addOns;
    h.elevationType ??= l.elevationType;
    h.houseInfo ??= l.houseInfo;
    if (!h.plan && l.planUrl) h.plan = l.id;
    if (l.startDate && (!h.start || l.startDate < h.start)) h.start = l.startDate;
    houses.set(k, h);
  }
  return [...houses.values()];
}

/** Builder names for the picker: builders under Contacts, plus any builder already on the schedule. */
export async function builderNames() {
  const [companies, onBoard] = await Promise.all([
    prisma.company.findMany({ where: { type: "BUILDER" }, select: { name: true } }),
    prisma.prodLine.groupBy({ by: ["builder"], where: { market: "RESIDENTIAL", builder: { not: null } } }),
  ]);
  const seen = new Map<string, string>();
  for (const n of [...companies.map((c) => c.name), ...onBoard.map((b) => b.builder!)]) if (!seen.has(key(n))) seen.set(key(n), n.trim());
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Model names from each builder's active plan books, for the model box's suggestions. */
export async function modelsByBuilder() {
  const builders = await prisma.company.findMany({ where: { type: "BUILDER" }, select: { id: true, name: true } });
  const out: Record<string, string[]> = {};
  for (const b of builders) {
    const names = (await activeBooks(b.id)).flatMap((book) => book.data.plans.map((p) => p.name));
    if (names.length) out[b.name] = [...new Set(names)].sort();
  }
  return out;
}

// ---------- material lists, sell and pay out per scope ----------
export type MatLine = { name: string; qty: number; unit: string };

export const materialsOf = (l: Pick<ProdLine, "materials">): MatLine[] => (Array.isArray(l.materials) ? (l.materials as MatLine[]) : []);

const elevKey = (e: string) => e.replace(/^\s*elev(ation)?\.?\s*/i, "").trim().toUpperCase();

/**
 * Roofing and gutters from the builder's plan book, when the model and elevation are in it (standard 2-car,
 * no porch; a walkout or daylight basement takes the book's daylight / walkout gutter add): the material list, sell and pay out exactly as the sheet has them. Anything the
 * book doesn't cover comes back empty, so it's typed in, never guessed.
 */
export async function planBookFill(builder: string, model: string, elevation: string, basement: string = "FULL_DIG") {
  const company = (await prisma.company.findMany({ where: { type: "BUILDER" }, select: { id: true, name: true } })).find((c) => key(c.name) === key(builder));
  if (!company) return null;
  for (const book of await activeBooks(company.id)) {
    const plan = findPlan(book.data.plans, model);
    if (!plan) continue;
    const label = [...plan.roofing, ...plan.gutters].find((o) => o.kind === "ELEVATION" && elevKey(o.label) === elevKey(elevation))?.label;
    if (!label) continue;
    const sel: Selection = { elevation: label, garage: "2", basement: basement === "WALKOUT" || basement === "DAYLIGHT" ? "DLWO" : "STANDARD", porch: false };
    const out = buildOut(book.data, plan, sel);
    const src = `${company.name} ${book.label} plan book: ${modelLabel(plan.name, sel)}`;
    const trade = (t: typeof out.roofing, tr: "ROOFING" | "GUTTERS") =>
      t.picked.length && !t.missing.length ? { materials: t.materials.map((m) => ({ name: m.name, qty: m.qty, unit: unitFor(m.name, tr) })), sell: t.sell, payout: t.payout, src } : null;
    return { roofing: trade(out.roofing, "ROOFING"), gutters: trade(out.gutters, "GUTTERS") };
  }
  return null;
}

/** Save one scope's material list, sell and pay out from the house's drop-down. */
export async function saveScopeDetails(id: string, input: { materials: { name: string; qty: string | number; unit: string }[]; sell: string; payout: string }, actor: Actor) {
  if (actor.role === "VIEWER") throw new ProdError("Viewers can't change the schedule.");
  const line = await prisma.prodLine.findUnique({ where: { id } });
  if (!line) throw new ProdError("That scope is no longer on the schedule.");
  const problems: string[] = [];
  const materials: MatLine[] = [];
  for (const [n, m] of input.materials.entries()) {
    const name = m.name.trim();
    const qtyText = String(m.qty).trim();
    if (!name && !qtyText) continue;
    const qty = Number(qtyText.replace(/,/g, ""));
    if (!name) problems.push(`Line ${n + 1}: enter the material.`);
    else if (!qtyText || !Number.isFinite(qty) || qty <= 0) problems.push(`${name}: enter a quantity above 0.`);
    else materials.push({ name, qty, unit: m.unit.trim() });
  }
  const money = (v: string, label: string) => {
    const t = v.replace(/[$,\s]/g, "");
    if (!t) return null;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) problems.push(`${label}: enter a dollar amount.`);
    return Math.round(n * 100) / 100;
  };
  const sell = money(input.sell, "Sell");
  const payout = money(input.payout, "Pay out");
  if (problems.length) throw new ProdError(problems.join(" "));
  const before = materialsOf(line);
  const changed = JSON.stringify(before) !== JSON.stringify(materials);
  return prisma.prodLine.update({
    where: { id },
    data: {
      materials,
      sell,
      payout,
      ...(changed ? { materialsSrc: line.materialsSrc ? `${line.materialsSrc.replace(/ · edited by .*$/, "")} · edited by ${actor.name}` : `Entered by ${actor.name}` } : {}),
      source: "APP",
      updatedBy: actor.name,
    },
  });
}
