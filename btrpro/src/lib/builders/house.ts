// A builder house as a real job: made from a plan-book model pick (or a builder's start sheet). The job is sold to
// the builder at the plan book's sell, its cost baseline is the plan book's materials / tax / crew payout, and the
// house goes on the production schedule linked to the job — so estimate, invoice and profit all live on the job.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import type { Baseline } from "@/lib/costing/pnl";
import { PlanBookError, priceHouse, scheduleHouse, type HouseTrade } from "./planbook";
import type { Mat, Selection } from "./plans";

type Actor = { id: string; name: string; role: string };
const r2 = (n: number) => Math.round(n * 100) / 100;

export type HouseTradeNums = { sell: number; payout: number; materials: number; tax: number; profit: number; options: string[] };
export type HouseData = {
  version: 1;
  bookId: string;
  bookLabel: string;
  builderId: string;
  builder: string;
  plan: string;
  sel: Selection;
  label: string;
  lot: string | null;
  subdivision: string | null;
  address: string;
  city: string | null;
  permit: string | null;
  color: string | null;
  startId: string | null;
  trades: Partial<Record<HouseTrade, HouseTradeNums>>;
  materials: Partial<Record<HouseTrade, Mat[]>>;
};

export type HouseJobInput = {
  lot?: string | null;
  subdivision?: string | null;
  address: string;
  city?: string | null;
  permit?: string | null;
  trades: HouseTrade[];
  crew?: string | null;
  superName?: string | null;
  vpo?: string | null;
  color?: string | null;
  notes?: string | null;
  startId?: string | null;
  startDate?: Date | null;
};

/** "Lot 12 Prairie View" / "123 Main St" — how the job and schedule name the house. */
export function houseName(i: { lot?: string | null; subdivision?: string | null; address: string }) {
  const lot = i.lot?.trim() ? `Lot ${i.lot.trim().replace(/^lot\s*/i, "")}` : null;
  return [lot && [lot, i.subdivision?.trim()].filter(Boolean).join(" "), i.address.trim()].filter(Boolean).join(" · ");
}

export async function createHouseJob(bookId: string, planName: string, sel: Selection, input: HouseJobInput, actor: Actor) {
  if (!["ADMIN", "ESTIMATOR", "OFFICE", "PURCHASING"].includes(actor.role)) throw new PlanBookError("Your role can't add jobs.");
  if (!input.address.trim()) throw new PlanBookError("Enter the house address (or lot).");
  // never the same house twice: a start sheet already added, or the same house added in the last hour (double click, Back)
  if (input.startId) {
    const st = await prisma.builderStart.findUnique({ where: { id: input.startId }, select: { status: true, prodLineIds: true } });
    if (st?.status === "SCHEDULED") {
      const line = await prisma.prodLine.findFirst({ where: { id: { in: (st.prodLineIds as string[] | null) ?? [] } }, select: { projectId: true } });
      throw new PlanBookError(`This start sheet was already added${line?.projectId ? ` — it's job /projects/${line.projectId}` : ""}.`);
    }
  }
  const priced = await priceHouse(bookId, planName, sel, input.trades);
  const { book, plan, out, label } = priced;
  const dupe = await prisma.project.findFirst({ where: { clientCompanyId: book.companyId, name: `${houseName(input)} — ${label}`, createdAt: { gte: new Date(Date.now() - 3_600_000) } }, select: { id: true } });
  if (dupe) throw new PlanBookError(`That house was just added — it's job /projects/${dupe.id}.`);
  const R = book.data.rates.roofing;

  const trades: HouseData["trades"] = {};
  const materials: HouseData["materials"] = {};
  for (const t of input.trades) {
    const tr = t === "ROOFING" ? out.roofing : out.gutters;
    // roofing: material cost + its sales tax are ours to buy; gutters: the sub's price is all-in (labor + material)
    const mat = t === "ROOFING" ? r2(tr.picked.reduce((a, o) => a + (o.materialCost ?? 0), 0)) : 0;
    const tax = t === "ROOFING" ? r2(tr.picked.reduce((a, o) => a + (o.tax ?? (o.materialCost ?? 0) * (R.taxPct ?? 0)), 0)) : 0;
    // profit as the sheet figures it (its sell carries fractions of a cent, so a remainder can be a few cents off)
    trades[t] = { sell: tr.sell, payout: tr.payout, materials: mat, tax, profit: tr.profit, options: tr.picked.map((o) => o.label) };
    materials[t] = tr.materials;
  }
  const sell = r2(Object.values(trades).reduce((a, t) => a + t!.sell, 0));
  const name = `${houseName(input)} — ${label}`;
  const data: HouseData = {
    version: 1,
    bookId: book.id,
    bookLabel: book.label,
    builderId: book.companyId,
    builder: book.company.name,
    plan: plan.name,
    sel,
    label,
    lot: input.lot?.trim() || null,
    subdivision: input.subdivision?.trim() || null,
    address: input.address.trim(),
    city: input.city?.trim() || null,
    permit: input.permit?.trim() || null,
    color: input.color?.trim() || null,
    startId: input.startId ?? null,
    trades,
    materials,
  };
  const baseline: Baseline = {
    estimateId: "",
    estimateName: `${book.company.name} ${book.label} plan book — ${label}`,
    revision: 0,
    materials: r2(Object.values(trades).reduce((a, t) => a + t!.materials, 0)),
    materialTax: r2(Object.values(trades).reduce((a, t) => a + t!.tax, 0)),
    taxNote: R.taxPct != null ? `${Math.round(R.taxPct * 1000) / 10}% from the plan book` : "from the plan book",
    generalConditions: 0,
    labor: r2(Object.values(trades).reduce((a, t) => a + t!.payout, 0)),
    contingency: 0,
    frozenBy: actor.name,
  };

  const project = await createProject(
    {
      name,
      market: "RESIDENTIAL",
      address: [input.address.trim(), input.city?.trim()].filter(Boolean).join(", "),
      scopes: ["STEEP"],
      isPublic: false,
      isTaxExempt: false,
      clientCompanyId: book.companyId,
      leadSource: "Builder start",
    },
    actor as never,
  );
  const now = new Date();
  await prisma.project.update({
    where: { id: project.id },
    data: {
      status: "SOLD",
      statusChangedAt: now,
      contractAmount: sell,
      contractSignedAt: now,
      builderHouse: data as unknown as Prisma.InputJsonValue,
      costBaseline: baseline as unknown as Prisma.InputJsonValue,
      costBaselineAt: now,
    },
  });
  let lines: Awaited<ReturnType<typeof scheduleHouse>>["lines"];
  try {
    ({ lines } = await scheduleHouse(
      bookId,
      planName,
      sel,
      { address: houseName(input), trades: input.trades, crew: input.crew, superName: input.superName, vpo: input.vpo, color: input.color, notes: [input.permit ? `Permit ${input.permit}` : null, input.notes].filter(Boolean).join(" · ") || null, projectId: project.id, startDate: input.startDate ?? null },
      actor,
      priced,
    ));
  } catch (e) {
    // don't leave a sold job behind with nothing on the schedule
    await prisma.prodLine.deleteMany({ where: { projectId: project.id } });
    await prisma.project.delete({ where: { id: project.id } }).catch(() => null);
    throw e;
  }
  if (input.startId) await prisma.builderStart.update({ where: { id: input.startId }, data: { status: "SCHEDULED", scheduledAt: now, prodLineIds: lines.map((l) => l.id), companyId: book.companyId } });
  return { project, lines, label, sell };
}

export const houseOf = (p: { builderHouse: unknown }) => (p.builderHouse ?? null) as HouseData | null;
