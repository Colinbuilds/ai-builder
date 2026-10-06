// Storing and using a builder's plan book: import (Google Sheet link or .xlsx upload) as a new version, read
// the active one, and put a house on the production schedule straight from a model pick.
import { prisma } from "@/lib/db";
import { readXlsx } from "@/lib/import/xlsx";
import { downloadSheet } from "@/lib/estimating/schedule";
import { addProdLine } from "@/lib/production/board";
import { PdfWriter } from "@/lib/pdf/writer";
import { BTR } from "@/lib/company";
import { buildOut, editOption, findPlan, modelLabel, parsePlanBook, type LineEdit, type PlanBookData, type Selection, type Trade } from "./plans";

export class PlanBookError extends Error {}
type Actor = { id: string; name: string; role: string };

export async function importPlanBook(companyId: string, input: { bytes?: Uint8Array; link?: string; label: string; fileName?: string }, actor: Actor) {
  if (actor.role === "VIEWER") throw new PlanBookError("Viewers can't import plan books.");
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company || company.type !== "BUILDER") throw new PlanBookError("That builder wasn't found.");
  if (!input.label.trim()) throw new PlanBookError("Name the plan book (e.g. Kansas City).");
  let bytes = input.bytes;
  if (!bytes?.length) {
    if (!input.link?.trim()) throw new PlanBookError("Paste the Google Sheet link or upload the .xlsx.");
    bytes = await downloadSheet(input.link.trim(), actor.id);
  }
  let data: PlanBookData;
  try {
    data = parsePlanBook(await readXlsx(bytes));
  } catch (e) {
    throw new PlanBookError(e instanceof Error ? e.message : String(e));
  }
  const label = input.label.trim();
  // a new import replaces the active book with the same name; older versions stay for comparison
  const prev = await prisma.builderPlanBook.findFirst({ where: { companyId, label, active: true } });
  const prevEdits = ((prev?.data as unknown as PlanBookData | undefined)?.edits ?? []).length;
  if (prevEdits) data.warnings.push(`${prevEdits} takeoff edit(s) made in BTRpro on the previous version were replaced by the sheet. Make them on the sheet too, or redo them here.`);
  await prisma.builderPlanBook.updateMany({ where: { companyId, label, active: true }, data: { active: false } });
  const book = await prisma.builderPlanBook.create({ data: { companyId, label, sourceUrl: input.link?.trim() || null, sourceName: input.fileName ?? null, data: data as never, importedBy: actor.name } });
  return { book, data };
}

export async function activeBooks(companyId: string) {
  const books = await prisma.builderPlanBook.findMany({ where: { companyId, active: true }, orderBy: { label: "asc" } });
  return books.map((b) => ({ ...b, data: b.data as unknown as PlanBookData }));
}

export async function getBook(id: string) {
  const b = await prisma.builderPlanBook.findUnique({ where: { id }, include: { company: { select: { id: true, name: true } } } });
  return b ? { ...b, data: b.data as unknown as PlanBookData } : null;
}

/** Houses on this builder's schedule in the last 12 months (for "$ per year" in the audit). */
export async function housesPerYear(builderName: string) {
  const since = new Date(Date.now() - 365 * 86_400_000);
  const word = builderName.replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter((w) => w.length > 2).sort((a, b) => b.length - a.length)[0] ?? builderName;
  const lines = await prisma.prodLine.findMany({ where: { builder: { contains: word }, OR: [{ dateAdded: { gte: since } }, { AND: [{ dateAdded: null }, { createdAt: { gte: since } }] }] }, select: { location: true } });
  return new Set(lines.map((l) => (l.location ?? "").trim().toLowerCase()).filter(Boolean)).size || null;
}

/** One click from a model pick: a schedule line per trade with the sell and payout from the plan book. */
export async function scheduleHouse(bookId: string, planName: string, sel: Selection, input: { address: string; trades: ("ROOFING" | "GUTTERS")[]; crew?: string | null; superName?: string | null; vpo?: string | null; notes?: string | null; color?: string | null }, actor: Actor) {
  if (actor.role === "VIEWER") throw new PlanBookError("Viewers can't add to the schedule.");
  if (!input.address.trim()) throw new PlanBookError("Enter the lot / address.");
  if (!input.trades.length) throw new PlanBookError("Pick roofing, gutters or both.");
  const book = await getBook(bookId);
  if (!book) throw new PlanBookError("That plan book is gone.");
  const plan = findPlan(book.data.plans, planName);
  if (!plan) throw new PlanBookError("That model isn't in the plan book.");
  const out = buildOut(book.data, plan, sel);
  const label = modelLabel(plan.name, sel);
  for (const t of input.trades) {
    const tr = t === "ROOFING" ? out.roofing : out.gutters;
    const name = t === "ROOFING" ? "Roofing" : "Gutters";
    if (!tr.picked.length) throw new PlanBookError(`${name} isn't priced for ${label}.`);
    if (tr.missing.length) throw new PlanBookError(`${name}: ${tr.missing.join("; ")} — fix the plan book or pick a different option.`);
  }
  const lines = [];
  for (const t of input.trades) {
    const tr = t === "ROOFING" ? out.roofing : out.gutters;
    lines.push(
      await addProdLine(
        {
          market: "RESIDENTIAL",
          board: "ADD",
          builder: book.company.name,
          location: input.address,
          model: label,
          type: t === "ROOFING" ? "Roofing" : "Gutters",
          crew: input.crew ?? null,
          superName: input.superName ?? null,
          vpo: input.vpo ?? null,
          sell: tr.sell,
          payout: tr.payout,
          notes: [input.color ? `Color: ${input.color}` : null, input.notes, `From ${book.company.name} ${book.label} plan book`].filter(Boolean).join(" · "),
        },
        actor,
      ),
    );
  }
  return { lines, label };
}

/** Change a model option's takeoff in BTRpro; the sell / payout / profit re-price from the sheet's own rates. */
export async function saveTakeoffEdit(bookId: string, planName: string, trade: Trade, optionLabel: string, lines: LineEdit[], squares: number | null, actor: Actor) {
  if (!["ADMIN", "ESTIMATOR", "PURCHASING"].includes(actor.role)) throw new PlanBookError("Only admins, estimators and purchasing can change a plan takeoff.");
  const book = await getBook(bookId);
  if (!book) throw new PlanBookError("That plan book is gone.");
  const plan = findPlan(book.data.plans, planName);
  const list = plan ? (trade === "ROOFING" ? plan.roofing : plan.gutters) : [];
  const i = list.findIndex((o) => o.label === optionLabel);
  if (!plan || i < 0) throw new PlanBookError("That option isn't in the plan book.");
  let r;
  try {
    r = editOption(book.data, trade, list[i], lines, squares);
  } catch (e) {
    throw new PlanBookError(e instanceof Error ? e.message : String(e));
  }
  if (!r.changes.length) return { changes: [], unpriced: [] };
  const before = list[i];
  list[i] = r.option;
  const data: PlanBookData = { ...book.data, edits: [...(book.data.edits ?? []), { plan: plan.name, trade, option: optionLabel, by: actor.name, at: new Date().toISOString(), changes: r.changes }] };
  await prisma.builderPlanBook.update({ where: { id: book.id }, data: { data: data as never } });
  await prisma.auditLog.create({ data: { userId: actor.id, entity: "BuilderPlanBook", entityId: book.id, action: "edit_takeoff", before: { plan: plan.name, trade, option: before } as never, after: { plan: plan.name, trade, option: r.option } as never } });
  return { changes: r.changes, unpriced: r.unpriced };
}

export type OrderSheet = { builder: string; model: string; address: string; po: string; deliver: string; color: string; notes: string; lines: { name: string; qty: string; unit: string }[] };

/** The order as edited on the Order tab — nothing is saved, it just prints. */
export async function planOrderPdf(o: OrderSheet) {
  const lines = o.lines.filter((l) => l.name.trim() && l.qty.trim() && Number(l.qty) !== 0);
  const w = await PdfWriter.create({ title: `Order ${o.builder} ${o.model}`, footer: `${BTR.name} · ${o.builder} · ${o.model}` });
  w.text(`${BTR.name.toUpperCase()}  ·  ${BTR.address}  ·  ${BTR.phone}`, { size: 8, gap: 8 });
  w.heading(`Material order — ${o.builder}`);
  w.text(`Model: ${o.model}`, { size: 10, bold: true, gap: 2 });
  w.text(`Deliver to: ${o.address.trim() || "ADDRESS MISSING"}`, { size: 10, bold: true, gap: 2 });
  w.text([o.po.trim() && `PO ${o.po.trim()}`, `Date: ${o.deliver.trim() || "MISSING"}`, o.color.trim() && `Color: ${o.color.trim()}`].filter(Boolean).join(" · "), { size: 10, gap: 8 });
  w.table(
    [
      { header: "Item", width: 380 },
      { header: "Qty", width: 70, align: "right" },
      { header: "Unit", width: 80 },
    ],
    lines.map((l) => [l.name.trim(), l.qty.trim(), l.unit.trim()]),
  );
  if (o.notes.trim()) w.text(`Notes: ${o.notes.trim()}`, { size: 10, gap: 4 });
  return w.save();
}
