import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { round } from "@/lib/calc/core";
import { totalsFor } from "@/lib/estimates/service";
import { getSettings } from "@/lib/settings";
import { getPriceItem } from "@/lib/price";
import { addDocument } from "@/lib/docs/documents";
import { COST_CATEGORIES, computePnl, crewCost, type Baseline, type CostCategory } from "./pnl";
import { parseInvoiceCsv, type InvoiceRow } from "./invoice-csv";

export type CostActor = { id: string | null; name: string; role: "ADMIN" | "ESTIMATOR" | "VIEWER" | "SYSTEM" };
export class CostError extends Error {}

type ProjectAccess = { estimatorId: string | null; salespersonId: string | null };

/** Viewers never see cost or margin. Estimators see their own jobs (or unassigned ones). Admins see everything. */
export function canSeeCosts(user: { id: string; role: string }, p: ProjectAccess) {
  if (user.role === "ADMIN") return true;
  if (user.role !== "ESTIMATOR") return false;
  if (!p.estimatorId && !p.salespersonId) return true;
  return p.estimatorId === user.id || p.salespersonId === user.id;
}

async function audit(actor: CostActor, entity: string, entityId: string, action: string, before: unknown, after: unknown) {
  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      entity,
      entityId,
      action,
      before: before == null ? Prisma.JsonNull : (JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue),
      after: after == null ? Prisma.JsonNull : (JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue),
    },
  });
}

async function activity(projectId: string, actor: CostActor, text: string) {
  await prisma.projectActivity.create({ data: { projectId, userId: actor.id, kind: "costing", text } });
}

/** A closed job's costs are locked: only an Admin may change them, and every change is audit-logged. */
async function guardEdit(projectId: string, actor: CostActor) {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { costClosedAt: true, estimatorId: true, salespersonId: true } });
  if (actor.role !== "SYSTEM" && actor.role !== "ADMIN" && !(actor.id && canSeeCosts({ id: actor.id, role: actor.role }, p)))
    throw new CostError("You don't have access to this job's costs.");
  if (p.costClosedAt && actor.role !== "ADMIN") throw new CostError("This job's costs are closed. Only an Admin can change them now.");
  return { closed: !!p.costClosedAt };
}

// ---------- baseline ----------

export async function freezeBaseline(projectId: string, estimateId: string, actor: CostActor, reason?: string | null, addOns: string[] = []) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const est = await prisma.estimate.findUniqueOrThrow({ where: { id: estimateId } });
  if (est.projectId !== projectId) throw new CostError("That estimate belongs to a different job.");
  if (project.costBaseline) {
    if (actor.role !== "ADMIN") throw new CostError("The baseline is already frozen. Only an Admin can replace it.");
    if (!reason?.trim()) throw new CostError("Say why the frozen baseline is being replaced.");
  }
  await guardEdit(projectId, actor);
  const t = await totalsFor(estimateId);
  if (t.incomplete) throw new CostError("That estimate is INCOMPLETE (some lines or labor have no number), so it can't be the cost baseline.");
  const s = await getSettings();
  const materialTax = project.isTaxExempt ? 0 : s.salesTaxPct == null ? null : round((t.materials * s.salesTaxPct) / 100, 2);
  const baseline: Baseline = {
    estimateId,
    estimateName: est.name,
    revision: est.revision,
    materials: t.materials,
    materialTax,
    taxNote: project.isTaxExempt ? "tax-exempt job" : s.salesTaxPct == null ? "no sales tax rate set — tax MISSING" : `${t.materials.toFixed(2)} × ${s.salesTaxPct}%`,
    generalConditions: t.generalConditions,
    labor: t.labor,
    contingency: t.contingency,
    frozenBy: actor.name,
    uncostedAddOns: addOns,
  };
  await prisma.project.update({ where: { id: projectId }, data: { costBaseline: baseline as unknown as Prisma.InputJsonValue, costBaselineAt: new Date() } });
  if (project.costBaseline) await audit(actor, "Project.costBaseline", projectId, "replace", project.costBaseline, { ...baseline, reason });
  await activity(projectId, actor, `${actor.name} ${project.costBaseline ? "replaced" : "froze"} the cost baseline from ${est.name} (rev ${est.revision})${reason ? `: ${reason}` : ""}`);
  return baseline;
}

// ---------- P&L ----------

export async function loadCosting(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      salesperson: { select: { id: true, name: true, commissionPlan: true } },
      costs: { orderBy: [{ date: "desc" }, { createdAt: "desc" }], include: { enteredBy: { select: { name: true } }, document: { select: { id: true, fileName: true } }, commitment: { select: { vendor: true, description: true } } } },
      commitments: { orderBy: { createdAt: "desc" }, include: { bills: { select: { amount: true } } } },
      changeOrders: { orderBy: { createdAt: "asc" } },
      bidResults: { orderBy: { createdAt: "desc" }, take: 1 },
      estimates: { select: { id: true, name: true, revision: true }, orderBy: { createdAt: "desc" } },
    },
  });
  const s = await getSettings();
  const plan = project.salesperson?.commissionPlan;
  const pnl = computePnl({
    contractAmount: project.contractAmount,
    changeOrders: project.changeOrders,
    baseline: project.costBaseline as unknown as Baseline | null,
    costs: project.costs,
    commitments: project.commitments,
    overheadPct: s.overheadPct,
    thresholdPct: s.costVarianceThresholdPct,
    commission: plan ? { basis: plan.basis, pct: plan.pct, person: project.salesperson!.name } : null,
  });
  if (!project.salesperson) pnl.missing.splice(pnl.missing.findIndex((m) => m.startsWith("Commission")), 1, "Salesperson on the job (for commission)");
  return { project, pnl, settings: s, noneExpected: (project.costNoneExpected as CostCategory[] | null) ?? [] };
}

// ---------- cost lines ----------

export type CostInput = {
  category: CostCategory;
  date: Date;
  vendor: string;
  reference?: string | null;
  description: string;
  amount?: number | null;
  kind?: string;
  hours?: number | null;
  rate?: number | null;
  burdenPct?: number | null;
  commitmentId?: string | null;
  file?: { bytes: Uint8Array; name: string; type: string | null } | null;
};

export async function addCost(projectId: string, input: CostInput, actor: CostActor) {
  const { closed } = await guardEdit(projectId, actor);
  if (!COST_CATEGORIES.includes(input.category)) throw new CostError("Pick a cost category.");
  if (!input.vendor.trim()) throw new CostError("Who was paid? Enter the vendor, crew, or sub.");
  if (!input.description.trim()) throw new CostError("Describe the cost.");
  if (!(input.date instanceof Date) || Number.isNaN(input.date.getTime())) throw new CostError("Enter the date.");
  let amount = input.amount ?? null;
  let formula: string | null = null;
  if (input.kind === "CREW_HOURS") {
    const { hours, rate, burdenPct } = input;
    if (hours == null || rate == null || burdenPct == null || [hours, rate, burdenPct].some((n) => !Number.isFinite(n) || n < 0))
      throw new CostError("Crew hours need hours, hourly rate, and burden % (enter 0 if there's no burden).");
    ({ amount, formula } = crewCost(hours, rate, burdenPct));
  }
  if (amount == null || !Number.isFinite(amount) || amount === 0) throw new CostError("Enter the amount (negative for a return or credit).");
  if (input.commitmentId) {
    const c = await prisma.costCommitment.findUnique({ where: { id: input.commitmentId } });
    if (!c || c.projectId !== projectId) throw new CostError("That commitment isn't on this job.");
  }
  let documentId: string | null = null;
  if (input.file?.bytes.length) {
    const { doc } = await addDocument({ projectId, bytes: input.file.bytes, fileName: input.file.name, contentType: input.file.type, userId: actor.id });
    documentId = doc.id;
  }
  const cost = await prisma.jobCost.create({
    data: {
      projectId,
      category: input.category,
      date: input.date,
      vendor: input.vendor.trim(),
      reference: input.reference?.trim() || null,
      description: input.description.trim(),
      amount: round(amount, 2),
      formula,
      kind: input.kind ?? (amount < 0 ? "CREDIT" : "INVOICE"),
      hours: input.hours ?? null,
      rate: input.rate ?? null,
      burdenPct: input.burdenPct ?? null,
      commitmentId: input.commitmentId ?? null,
      documentId,
      enteredById: actor.id,
    },
  });
  if (closed) await audit(actor, "JobCost", cost.id, "create-after-close", null, cost);
  return cost;
}

export async function deleteCost(costId: string, reason: string, actor: CostActor) {
  const cost = await prisma.jobCost.findUniqueOrThrow({ where: { id: costId } });
  await guardEdit(cost.projectId, actor);
  if (!reason.trim()) throw new CostError("Say why the cost is being removed.");
  await prisma.jobCost.delete({ where: { id: costId } });
  await audit(actor, "JobCost", costId, "delete", cost, { reason });
  await activity(cost.projectId, actor, `${actor.name} removed cost "${cost.description}" ($${cost.amount.toFixed(2)}, ${cost.vendor}): ${reason}`);
}

// ---------- commitments ----------

export async function addCommitment(projectId: string, input: { category: CostCategory; vendor: string; description: string; amount: number; reference?: string | null }, actor: CostActor) {
  await guardEdit(projectId, actor);
  if (!input.vendor.trim() || !input.description.trim()) throw new CostError("Enter the vendor and what was committed.");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new CostError("Enter the committed amount.");
  const c = await prisma.costCommitment.create({
    data: { projectId, category: input.category, vendor: input.vendor.trim(), description: input.description.trim(), amount: round(input.amount, 2), reference: input.reference?.trim() || null, enteredBy: actor.name },
  });
  await activity(projectId, actor, `${actor.name} committed $${c.amount.toFixed(2)} to ${c.vendor} (${c.description})`);
  return c;
}

export async function setCommitmentStatus(id: string, status: "OPEN" | "BILLED" | "CANCELLED", actor: CostActor) {
  const c = await prisma.costCommitment.findUniqueOrThrow({ where: { id } });
  await guardEdit(c.projectId, actor);
  await prisma.costCommitment.update({ where: { id }, data: { status } });
  await audit(actor, "CostCommitment", id, "status", { status: c.status }, { status });
}

// ---------- change orders ----------

export async function addChangeOrder(
  projectId: string,
  input: { kind: "CHANGE_ORDER" | "SUPPLEMENT" | "CREDIT"; description: string; amount: number; costImpact: number | null; source: string | null },
  actor: CostActor,
) {
  await guardEdit(projectId, actor);
  if (!input.description.trim()) throw new CostError("Describe the change.");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new CostError("Enter the amount as a positive number (a credit subtracts on its own).");
  if (input.costImpact != null && !Number.isFinite(input.costImpact)) throw new CostError("Cost impact must be a number.");
  const n = await prisma.changeOrder.count({ where: { projectId } });
  const prefix = input.kind === "SUPPLEMENT" ? "SUP" : input.kind === "CREDIT" ? "CR" : "CO";
  const co = await prisma.changeOrder.create({
    data: { projectId, number: `${prefix}-${String(n + 1).padStart(3, "0")}`, kind: input.kind, description: input.description.trim(), amount: round(input.amount, 2), costImpact: input.costImpact == null ? null : round(input.costImpact, 2), source: input.source?.trim() || null, createdBy: actor.name },
  });
  await activity(projectId, actor, `${actor.name} added ${co.number} (${co.kind.replace("_", " ").toLowerCase()}): ${co.description}, $${co.amount.toFixed(2)} — pending approval`);
  return co;
}

export async function decideChangeOrder(id: string, decision: "APPROVED" | "REJECTED", actor: CostActor) {
  const co = await prisma.changeOrder.findUniqueOrThrow({ where: { id } });
  await guardEdit(co.projectId, actor);
  if (co.status !== "PENDING" && actor.role !== "ADMIN") throw new CostError(`${co.number} was already ${co.status.toLowerCase()}. Only an Admin can change that.`);
  const out = await prisma.changeOrder.update({ where: { id }, data: { status: decision, decidedAt: new Date(), decidedBy: actor.name } });
  await audit(actor, "ChangeOrder", id, "decide", { status: co.status }, { status: decision });
  await activity(co.projectId, actor, `${actor.name} marked ${co.number} ${decision.toLowerCase()} ($${co.amount.toFixed(2)})`);
  return out;
}

// ---------- supplier invoice import ----------

export type ImportPreviewRow = InvoiceRow & { status: "NEW" | "DUPLICATE" | "OTHER_JOB"; note: string | null; sheetPrice: number | null; priceFlag: string | null };

async function classifyRows(projectId: string, rows: InvoiceRow[]) {
  const out: ImportPreviewRow[] = [];
  for (const r of rows) {
    const same = r.invoice
      ? await prisma.jobCost.findFirst({ where: { kind: "IMPORT", reference: r.invoice, description: r.description, amount: r.amount, itemNumber: r.itemNumber }, include: { project: { select: { name: true } } } })
      : null;
    let sheetPrice: number | null = null;
    let priceFlag: string | null = null;
    if (r.itemNumber && r.unitPrice != null) {
      const item = await getPriceItem(r.itemNumber);
      if (item?.unitPrice != null && r.uom && item.uom.toUpperCase() === r.uom) {
        sheetPrice = item.unitPrice;
        if (Math.abs(r.unitPrice - item.unitPrice) > Math.max(0.01, item.unitPrice * 0.005))
          priceFlag = `billed $${r.unitPrice.toFixed(2)}/${r.uom} vs $${item.unitPrice.toFixed(2)} on sheet ${item.sheet.code}`;
      }
    }
    out.push({
      ...r,
      sheetPrice,
      priceFlag,
      status: !same ? "NEW" : same.projectId === projectId ? "DUPLICATE" : "OTHER_JOB",
      note: !same ? null : same.projectId === projectId ? "already imported on this job" : `already imported on ${same.project.name}`,
    });
  }
  return out;
}

export async function previewInvoiceImport(projectId: string, csv: string) {
  const parsed = parseInvoiceCsv(csv);
  const rows = await classifyRows(projectId, parsed.rows);
  return { ...parsed, rows };
}

export async function importInvoices(projectId: string, csv: string, opts: { pos: string[] | null; vendor: string; file?: { bytes: Uint8Array; name: string } | null }, actor: CostActor) {
  const { closed } = await guardEdit(projectId, actor);
  if (!opts.vendor.trim()) throw new CostError("Enter the supplier name.");
  const parsed = parseInvoiceCsv(csv);
  if (!parsed.rows.length) throw new CostError(parsed.problems[0] ?? "Nothing to import.");
  const keep = parsed.rows.filter((r) => !opts.pos?.length || (r.po != null && opts.pos.includes(r.po)));
  const rows = (await classifyRows(projectId, keep)).filter((r) => r.status === "NEW");
  if (!rows.length) throw new CostError("Every line in this file is already imported (or filtered out by PO).");
  let documentId: string | null = null;
  if (opts.file?.bytes.length) {
    const { doc } = await addDocument({ projectId, bytes: opts.file.bytes, fileName: opts.file.name, contentType: "text/csv", userId: actor.id });
    documentId = doc.id;
  }
  const batch = `imp_${Date.now().toString(36)}`;
  const today = new Date();
  const created = await prisma.$transaction(async (tx) => {
    const lines = [];
    for (const r of rows) {
      lines.push(
        await tx.jobCost.create({
          data: {
            projectId,
            category: "MATERIALS",
            date: r.date ? new Date(`${r.date}T12:00:00`) : today,
            vendor: opts.vendor.trim(),
            reference: r.invoice,
            description: r.description,
            amount: r.amount,
            formula: r.formula,
            kind: "IMPORT",
            quantity: r.quantity,
            unit: r.uom,
            unitPrice: r.unitPrice,
            itemNumber: r.itemNumber,
            sheetPrice: r.sheetPrice,
            importBatch: batch,
            documentId,
            enteredById: actor.id,
          },
        }),
      );
    }
    // tax is billed per line on some exports; carry it as one line per invoice
    const taxByInv = new Map<string, { tax: number; date: string | null }>();
    for (const r of rows) {
      if (!r.tax) continue;
      const k = r.invoice ?? "(no invoice #)";
      const cur = taxByInv.get(k);
      taxByInv.set(k, { tax: round((cur?.tax ?? 0) + r.tax, 2), date: cur?.date ?? r.date });
    }
    for (const [inv, { tax, date }] of taxByInv)
      lines.push(
        await tx.jobCost.create({
          data: { projectId, category: "MATERIALS", date: date ? new Date(`${date}T12:00:00`) : today, vendor: opts.vendor.trim(), reference: inv, description: `Sales tax — invoice ${inv}`, amount: tax, kind: "IMPORT", importBatch: batch, documentId, enteredById: actor.id },
        }),
      );
    return lines;
  });
  const total = round(created.reduce((a, c) => a + c.amount, 0), 2);
  const flagged = rows.filter((r) => r.priceFlag).length;
  await activity(projectId, actor, `${actor.name} imported ${created.length} invoice line(s) from ${opts.vendor.trim()} totaling $${total.toFixed(2)}${flagged ? ` — ${flagged} billed off the price sheet` : ""}`);
  if (closed) await audit(actor, "JobCost", batch, "import-after-close", null, { lines: created.length, total });
  return { count: created.length, total, flagged, skipped: keep.length - rows.length };
}

// ---------- close-out ----------

export async function setNoneExpected(projectId: string, category: CostCategory, none: boolean, actor: CostActor) {
  await guardEdit(projectId, actor);
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { costNoneExpected: true } });
  const cur = new Set((p.costNoneExpected as CostCategory[] | null) ?? []);
  if (none) cur.add(category);
  else cur.delete(category);
  await prisma.project.update({ where: { id: projectId }, data: { costNoneExpected: [...cur] } });
}

export async function closeoutProblems(projectId: string) {
  const { project, pnl, noneExpected } = await loadCosting(projectId);
  const problems: string[] = [];
  if (project.contractAmount == null) problems.push("Contract amount is MISSING.");
  if (!project.costBaseline) problems.push("No estimated-cost baseline has been frozen.");
  for (const c of COST_CATEGORIES)
    if (!project.costs.some((x) => x.category === c) && !noneExpected.includes(c)) problems.push(`No ${c.toLowerCase()} costs entered. Enter the bills or mark "none expected".`);
  if (pnl.committed > 0) problems.push(`$${pnl.committed.toFixed(2)} is still committed but not billed (open orders or sub proposals). Enter the bills or close the commitments.`);
  const pending = project.changeOrders.filter((c) => c.status === "PENDING");
  if (pending.length) problems.push(`Change order(s) still pending: ${pending.map((c) => c.number).join(", ")}.`);
  return problems;
}

export async function closeCosting(projectId: string, actor: CostActor) {
  await guardEdit(projectId, actor);
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (p.costClosedAt) throw new CostError("Already closed.");
  const problems = await closeoutProblems(projectId);
  if (problems.length) throw new CostError(problems.join(" "));
  const { pnl } = await loadCosting(projectId);
  await prisma.project.update({ where: { id: projectId }, data: { costClosedAt: new Date(), costClosedBy: actor.name, finalPnl: JSON.parse(JSON.stringify(pnl)) } });
  await activity(projectId, actor, `${actor.name} closed job costing. Final gross profit $${pnl.grossProfit?.toFixed(2)} (${pnl.grossMarginPct}%)`);
}

export async function reopenCosting(projectId: string, reason: string, actor: CostActor) {
  if (actor.role !== "ADMIN") throw new CostError("Only an Admin can reopen closed job costs.");
  if (!reason.trim()) throw new CostError("Say why the job's costs are being reopened.");
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (!p.costClosedAt) throw new CostError("Job costing isn't closed.");
  await prisma.project.update({ where: { id: projectId }, data: { costClosedAt: null, costClosedBy: null } });
  await audit(actor, "Project.costing", projectId, "reopen", { closedAt: p.costClosedAt, closedBy: p.costClosedBy, finalPnl: p.finalPnl }, { reason });
  await activity(projectId, actor, `${actor.name} reopened job costing: ${reason}`);
}

// ---------- commission plans & bid results ----------

export async function saveCommissionPlan(userId: string, plan: { basis: "REVENUE" | "GROSS_PROFIT"; pct: number; note?: string | null } | null, actor: CostActor) {
  if (actor.role !== "ADMIN") throw new CostError("Only an Admin sets commission plans.");
  const before = await prisma.commissionPlan.findUnique({ where: { userId } });
  if (!plan) {
    if (before) await prisma.commissionPlan.delete({ where: { userId } });
  } else {
    if (!Number.isFinite(plan.pct) || plan.pct < 0 || plan.pct > 100) throw new CostError("Commission % must be between 0 and 100.");
    await prisma.commissionPlan.upsert({ where: { userId }, update: { ...plan, updatedBy: actor.name }, create: { userId, ...plan, updatedBy: actor.name } });
  }
  await audit(actor, "CommissionPlan", userId, "update", before, plan);
}

export async function saveBidResult(projectId: string, input: { ourBid: number | null; won: boolean | null; tabs: { bidder: string; amount: number }[]; notes: string | null }, actor: CostActor) {
  if (actor.role === "VIEWER") throw new CostError("Viewers can't enter bid results.");
  for (const t of input.tabs) if (!t.bidder.trim() || !Number.isFinite(t.amount)) throw new CostError("Each bid tab row needs a bidder and an amount.");
  const existing = await prisma.bidResult.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" } });
  const data = { ourBid: input.ourBid, won: input.won, bidTabs: input.tabs, notes: input.notes };
  if (existing) await prisma.bidResult.update({ where: { id: existing.id }, data });
  else await prisma.bidResult.create({ data: { projectId, ...data } });
  await activity(projectId, actor, `${actor.name} recorded the bid tab (${input.tabs.length} bidder${input.tabs.length === 1 ? "" : "s"})`);
}
