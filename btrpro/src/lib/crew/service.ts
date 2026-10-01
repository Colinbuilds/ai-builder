// Crew portal: job photos (before, progress, finished, cleanup) and crew invoices, plus the office's review of both.
// Finished-work and site-cleanup photos from the crew are required before the crew can invoice the job.
import type { Role } from "@/lib/session";
import { prisma } from "@/lib/db";
import { alertPMs } from "@/lib/sms";
import { readUpload, saveUpload } from "@/lib/storage";
import { addCost } from "@/lib/costing/service";
import { sniff } from "@/lib/portal/crew";
import { IMAGE_TYPE, MAX_PHOTO_BYTES, imageKind } from "@/lib/photos/images";
import { round } from "@/lib/calc/core";

export class CrewError extends Error {}
export const PHOTO_STAGES = ["BEFORE", "PROGRESS", "FINISHED", "CLEANUP"] as const;
export type PhotoStage = (typeof PHOTO_STAGES)[number];
export const STAGE_LABEL: Record<PhotoStage, string> = { BEFORE: "Before", PROGRESS: "During the job", FINISHED: "Finished work", CLEANUP: "Site cleanup" };
export const STAGE_HINT: Record<PhotoStage, string> = {
  BEFORE: "The roof/walls and the property before you start (driveway, landscaping, any existing damage).",
  PROGRESS: "Tear-off, decking, underlayment, flashing details — anything that gets covered up.",
  FINISHED: "Every slope or elevation, ridge, valleys, flashings, trim — the finished work up close and from the ground.",
  CLEANUP: "Yard, driveway, beds, gutters and the street, cleaned up — magnet sweep done, no debris or nails.",
};
/** Required from the crew before they can send an invoice for the job. */
export const REQUIRED_STAGES: PhotoStage[] = ["FINISHED", "CLEANUP"];
export const MAX_PHOTOS_PER_UPLOAD = 12;

const ACTIVE_JOB = { status: { notIn: ["LOST", "CLOSED"] as never[] } };

/** Jobs a crew can photograph and invoice: ones it's scheduled on or has a work order for. */
export async function crewJobs(crewId: string) {
  const projects = await prisma.project.findMany({
    where: {
      ...ACTIVE_JOB,
      OR: [{ scheduleEvents: { some: { crewId, status: { not: "CANCELLED" } } } }, { workOrders: { some: { crewId, status: { not: "CANCELLED" } } } }],
    },
    select: { id: true, name: true, address: true, status: true },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  const counts = await prisma.jobPhoto.groupBy({ by: ["projectId", "stage"], where: { crewId, projectId: { in: projects.map((p) => p.id) } }, _count: true });
  return projects.map((p) => {
    const n = Object.fromEntries(PHOTO_STAGES.map((s) => [s, counts.find((c) => c.projectId === p.id && c.stage === s)?._count ?? 0])) as Record<PhotoStage, number>;
    return { ...p, photos: n, missing: REQUIRED_STAGES.filter((s) => !n[s]) };
  });
}

async function assertOnJob(crewId: string, projectId: string) {
  const ok = await prisma.project.count({
    where: {
      id: projectId,
      ...ACTIVE_JOB,
      OR: [{ scheduleEvents: { some: { crewId, status: { not: "CANCELLED" } } } }, { workOrders: { some: { crewId, status: { not: "CANCELLED" } } } }],
    },
  });
  if (!ok) throw new CrewError("That job isn't assigned to your crew. Call the office.");
}

export async function addJobPhotos(
  who: { crewId: string | null; name: string },
  projectId: string,
  stage: string,
  files: { bytes: Uint8Array; name: string }[],
  note: string | null,
) {
  if (!PHOTO_STAGES.includes(stage as PhotoStage)) throw new CrewError("Pick what the photos show.");
  if (who.crewId) await assertOnJob(who.crewId, projectId);
  const real = files.filter((f) => f.bytes.length);
  if (!real.length) throw new CrewError("Take or choose at least one photo.");
  if (real.length > MAX_PHOTOS_PER_UPLOAD) throw new CrewError(`Send up to ${MAX_PHOTOS_PER_UPLOAD} photos at a time.`);
  const saved = [];
  for (const f of real) {
    if (f.bytes.length > MAX_PHOTO_BYTES) throw new CrewError(`${f.name} is over 20 MB.`);
    const kind = imageKind(f.bytes);
    if (!kind) throw new CrewError(`${f.name} isn't a photo.`);
    const fileUrl = await saveUpload(f.bytes, `${stage.toLowerCase()}.${kind}`, `projects/${projectId}/photos`);
    saved.push(
      await prisma.jobPhoto.create({
        data: { projectId, crewId: who.crewId, uploadedBy: who.name, stage, note: note?.trim().slice(0, 500) || null, fileUrl, contentType: IMAGE_TYPE[kind] },
      }),
    );
  }
  await prisma.projectActivity.create({
    data: { projectId, kind: "photos", text: `${who.name} added ${saved.length} ${STAGE_LABEL[stage as PhotoStage].toLowerCase()} photo${saved.length === 1 ? "" : "s"}` },
  });
  // project managers hear when a crew starts (first "before" photos of the day) and finishes
  if (who.crewId && (stage === "BEFORE" || stage === "FINISHED")) {
    const today = new Date(new Date().toISOString().slice(0, 10));
    const earlier = await prisma.jobPhoto.count({ where: { projectId, crewId: who.crewId, stage, takenAt: { gte: today }, id: { notIn: saved.map((x) => x.id) } } });
    if (!earlier) await alertPMs(projectId, stage === "BEFORE" ? `${who.name} started on site` : `${who.name} finished — photos are in for review`);
  }
  return saved;
}

export async function reviewPhoto(id: string, review: "OK" | "ISSUE", note: string | null, actor: { name: string; role: string }) {
  if (actor.role === "VIEWER") throw new CrewError("Viewers can't review photos.");
  if (review === "ISSUE" && !note?.trim()) throw new CrewError("Say what's wrong (quality or cleanup) so the crew can fix it.");
  const p = await prisma.jobPhoto.update({ where: { id }, data: { review, reviewNote: note?.trim() || null, reviewedBy: actor.name, reviewedAt: new Date() } });
  if (review === "ISSUE")
    await prisma.projectActivity.create({ data: { projectId: p.projectId, kind: "photos", text: `${actor.name} flagged a ${STAGE_LABEL[p.stage as PhotoStage].toLowerCase()} photo: ${note!.trim()}` } });
  return p;
}

// ---------- crew invoices ----------

export async function submitCrewInvoice(
  crewId: string,
  input: { projectId: string; invoiceNumber: string | null; invoiceDate: Date; amount: number; description: string; file: { bytes: Uint8Array; name: string } | null },
) {
  await assertOnJob(crewId, input.projectId);
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new CrewError("Enter the invoice amount.");
  if (Number.isNaN(input.invoiceDate.getTime())) throw new CrewError("Enter the invoice date.");
  if (!input.description.trim()) throw new CrewError("Say what the invoice is for (e.g. tear-off and install, 32 SQ).");
  const have = await prisma.jobPhoto.groupBy({ by: ["stage"], where: { crewId, projectId: input.projectId }, _count: true });
  const missing = REQUIRED_STAGES.filter((s) => !have.some((h) => h.stage === s));
  if (missing.length) throw new CrewError(`Add your ${missing.map((s) => STAGE_LABEL[s].toLowerCase()).join(" and ")} photos for this job first. They're required before you can invoice.`);
  const num = input.invoiceNumber?.trim() || null;
  if (num && (await prisma.crewInvoice.findFirst({ where: { crewId, invoiceNumber: num, status: { not: "REJECTED" } } })))
    throw new CrewError(`You already sent invoice ${num}.`);
  let fileUrl: string | null = null;
  let contentType: string | null = null;
  if (input.file?.bytes.length) {
    if (input.file.bytes.length > MAX_PHOTO_BYTES) throw new CrewError("That file is over 20 MB.");
    const kind = sniff(input.file.bytes);
    if (!kind) throw new CrewError("Attach a PDF or a photo of the invoice.");
    fileUrl = await saveUpload(input.file.bytes, `invoice.${kind}`, `crew-invoices/${crewId}`);
    contentType = kind === "pdf" ? "application/pdf" : IMAGE_TYPE[kind];
  }
  const crew = await prisma.crew.findUniqueOrThrow({ where: { id: crewId }, select: { name: true } });
  const inv = await prisma.crewInvoice.create({
    data: { crewId, projectId: input.projectId, invoiceNumber: num, invoiceDate: input.invoiceDate, amount: round(input.amount, 2), description: input.description.trim().slice(0, 1000), fileUrl, contentType },
  });
  await prisma.projectActivity.create({
    data: { projectId: input.projectId, kind: "crew_invoice", text: `${crew.name} sent invoice${num ? ` ${num}` : ""} for $${inv.amount.toFixed(2)} from the crew portal — review it under Production → Crew invoices` },
  });
  return inv;
}

/** Office approval: the invoice becomes a labor/sub cost on the job (with the invoice file on the job's documents). */
export async function reviewCrewInvoice(id: string, decision: "APPROVED" | "REJECTED", note: string | null, actor: { id: string; name: string; role: Role }) {
  if (actor.role === "VIEWER") throw new CrewError("Viewers can't approve invoices.");
  const inv = await prisma.crewInvoice.findUniqueOrThrow({ where: { id }, include: { crew: true } });
  if (inv.status !== "SUBMITTED") throw new CrewError(`This invoice was already ${inv.status.toLowerCase()}.`);
  if (decision === "REJECTED") {
    if (!note?.trim()) throw new CrewError("Give the crew a reason.");
    await prisma.crewInvoice.update({ where: { id }, data: { status: "REJECTED", reviewNote: note.trim(), reviewedBy: actor.name, reviewedAt: new Date() } });
    await prisma.projectActivity.create({ data: { projectId: inv.projectId, userId: actor.id, kind: "crew_invoice", text: `${actor.name} sent back ${inv.crew.name}'s invoice${inv.invoiceNumber ? ` ${inv.invoiceNumber}` : ""}: ${note.trim()}` } });
    return null;
  }
  // BTR rule: the office approves crew pay only after the required finished and cleanup photos are approved
  const okStages = await prisma.jobPhoto.groupBy({ by: ["stage"], where: { projectId: inv.projectId, crewId: inv.crewId, review: "OK" }, _count: true });
  const notOk = REQUIRED_STAGES.filter((s) => !okStages.some((h) => h.stage === s));
  if (notOk.length)
    throw new CrewError(`Approve ${inv.crew.name}'s ${notOk.map((s) => STAGE_LABEL[s].toLowerCase()).join(" and ")} photos for this job first (Production → Crew photos).`);
  const openPunch = await prisma.punchItem.count({ where: { projectId: inv.projectId, doneAt: null } });
  if (openPunch) throw new CrewError(`This job has ${openPunch} open punch-list item${openPunch === 1 ? "" : "s"}. Clear them before approving crew pay.`);
  const file = inv.fileUrl ? { bytes: new Uint8Array(await readUpload(inv.fileUrl)), name: `${inv.crew.name} invoice ${inv.invoiceNumber ?? inv.invoiceDate.toISOString().slice(0, 10)}.${inv.contentType === "application/pdf" ? "pdf" : "jpg"}`, type: inv.contentType } : null;
  const cost = await addCost(
    inv.projectId,
    {
      category: inv.crew.kind === "SUB" ? "SUBCONTRACTOR" : "LABOR",
      date: inv.invoiceDate,
      vendor: inv.crew.name,
      reference: inv.invoiceNumber,
      description: inv.description,
      amount: inv.amount,
      kind: "SUB_BILL",
      file,
    },
    actor,
  );
  await prisma.crewInvoice.update({ where: { id }, data: { status: "APPROVED", reviewNote: note?.trim() || null, reviewedBy: actor.name, reviewedAt: new Date(), jobCostId: cost.id } });
  await prisma.projectActivity.create({ data: { projectId: inv.projectId, userId: actor.id, kind: "crew_invoice", text: `${actor.name} approved ${inv.crew.name}'s invoice${inv.invoiceNumber ? ` ${inv.invoiceNumber}` : ""} ($${inv.amount.toFixed(2)}) into job costs` } });
  return cost;
}

export async function markCrewInvoicePaid(id: string, actor: { name: string; role: string }) {
  if (actor.role !== "ADMIN" && actor.role !== "OFFICE") throw new CrewError("Only the office or an Admin marks crew invoices paid.");
  const inv = await prisma.crewInvoice.findUniqueOrThrow({ where: { id } });
  if (inv.status !== "APPROVED") throw new CrewError("Approve the invoice before marking it paid.");
  return prisma.crewInvoice.update({ where: { id }, data: { status: "PAID", paidAt: new Date() } });
}

