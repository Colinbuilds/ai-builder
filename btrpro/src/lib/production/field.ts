// Production follow-through: ready-to-schedule checklist (warnings, never a block), punch list, and
// crew-reported field issues.
import { prisma } from "@/lib/db";
import { saveUpload } from "@/lib/storage";
import { crewNotice } from "@/lib/crew/notice";
import { addChangeOrder } from "@/lib/costing/service";
import type { Role } from "@/lib/session";

export class FieldError extends Error {}
type Actor = { id: string; name: string; role: Role };

export const MANUAL_READY = [
  ["color", "Product & color confirmed with the customer"],
  ["permit", "Permit pulled (if required)"],
  ["dumpster", "Dumpster ordered"],
  ["notified", "Customer told the install date"],
] as const;

export type ReadyItem = { key: string; label: string; ok: boolean | null; detail?: string; manual?: boolean };

/** What should be true before an install goes on the calendar. Nothing here blocks scheduling. */
export async function readyChecklist(projectId: string): Promise<ReadyItem[]> {
  const p = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      invoices: { where: { kind: "DEPOSIT", status: { not: "VOID" } }, include: { payments: { select: { amount: true } } } },
      materialOrders: { where: { status: { not: "CANCELLED" } }, select: { status: true, confirmedDate: true, number: true } },
      scheduleEvents: { where: { kind: { in: ["INSTALL", "TEAR_OFF"] }, status: { not: "CANCELLED" } }, orderBy: { startDate: "asc" }, include: { crew: true } },
    },
  });
  const install = p.scheduleEvents[0] ?? null;
  const checks = (p.readyChecks as Record<string, boolean> | null) ?? {};
  const items: ReadyItem[] = [];
  items.push({ key: "contract", label: "Contract signed", ok: !!p.contractSignedAt, detail: p.contractSignedAt ? undefined : "No signed contract on the job yet." });
  if (p.market === "RESIDENTIAL") {
    const paid = p.invoices.reduce((a, i) => a + i.payments.reduce((b, x) => b + x.amount, 0), 0);
    items.push({ key: "deposit", label: "Deposit paid", ok: p.invoices.length ? paid > 0 : false, detail: !p.invoices.length ? "No deposit invoice." : paid > 0 ? undefined : "Deposit invoice not paid yet." });
  }
  if (p.isPublic && p.isTaxExempt) items.push({ key: "form17", label: "Form 17 executed (office)", ok: p.form17Status === "EXECUTED", detail: p.form17Status === "EXECUTED" ? undefined : "Tax-exempt public job — the office gets it signed with the owner." });
  const delivered = p.materialOrders.some((o) => o.status === "DELIVERED");
  const confirmed = p.materialOrders.filter((o) => o.confirmedDate);
  const beforeInstall = install ? confirmed.some((o) => o.confirmedDate! <= install.startDate) : confirmed.length > 0;
  items.push({
    key: "materials",
    label: "Materials ordered, delivery confirmed before the install",
    ok: !p.materialOrders.length ? false : delivered || beforeInstall,
    detail: !p.materialOrders.length ? "No material order." : delivered || beforeInstall ? undefined : install ? "No delivery confirmed on or before the install date." : "Delivery not confirmed yet.",
  });
  if (install?.crew) {
    const when = install.startDate;
    const lapsed = [install.crew.coiExpires && install.crew.coiExpires < when ? "COI" : null, install.crew.workersCompExpires && install.crew.workersCompExpires < when ? "workers' comp" : null].filter(Boolean);
    items.push({ key: "coi", label: `${install.crew.name}'s insurance current`, ok: !lapsed.length && !!install.crew.coiExpires, detail: lapsed.length ? `${lapsed.join(" and ")} expired by the install date.` : !install.crew.coiExpires ? "No COI on file." : undefined });
  } else items.push({ key: "crew", label: "Crew assigned", ok: false, detail: install ? "The install has no crew." : "No install on the schedule yet." });
  for (const [key, label] of MANUAL_READY) items.push({ key, label, ok: !!checks[key], manual: true });
  return items;
}

export async function setReadyCheck(projectId: string, key: string, on: boolean, actor: Actor) {
  if (!MANUAL_READY.some(([k]) => k === key)) throw new FieldError("Unknown item.");
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { readyChecks: true } });
  const checks = { ...((p.readyChecks as Record<string, boolean> | null) ?? {}), [key]: on };
  await prisma.project.update({ where: { id: projectId }, data: { readyChecks: checks } });
  if (on) await prisma.projectActivity.create({ data: { projectId, userId: actor.id, kind: "production", text: `${actor.name} checked: ${MANUAL_READY.find(([k]) => k === key)![1]}` } });
}

// ---------- punch list ----------

export async function addPunch(projectId: string, text: string, crewId: string | null, actor: Actor) {
  if (!text.trim()) throw new FieldError("Say what needs fixing.");
  const item = await prisma.punchItem.create({ data: { projectId, text: text.trim(), crewId, createdBy: actor.name } });
  await prisma.projectActivity.create({ data: { projectId, userId: actor.id, kind: "production", text: `${actor.name} added a punch item: ${item.text}` } });
  return item;
}

export async function setPunchDone(id: string, done: boolean, actor: Actor) {
  const item = await prisma.punchItem.update({ where: { id }, data: done ? { doneAt: new Date(), doneBy: actor.name } : { doneAt: null, doneBy: null } });
  if (done) await prisma.projectActivity.create({ data: { projectId: item.projectId, userId: actor.id, kind: "production", text: `${actor.name} cleared punch item: ${item.text}` } });
  return item;
}

// ---------- field issues (crew portal) ----------

export async function reportIssue(crew: { crewId: string; name: string }, projectId: string, note: string, files: { bytes: Uint8Array; name: string }[]) {
  if (!note.trim()) throw new FieldError("Say what you found and roughly how much (e.g. rotted decking, about 6 sheets, back slope).");
  if (!files.length) throw new FieldError("Add at least one photo of it.");
  const assigned = await prisma.scheduleEvent.findFirst({ where: { projectId, crewId: crew.crewId } }) ?? (await prisma.workOrder.findFirst({ where: { projectId, crewId: crew.crewId } }));
  if (!assigned) throw new FieldError("That job isn't assigned to your crew.");
  const photos = [];
  for (const f of files.slice(0, 8)) photos.push({ url: await saveUpload(f.bytes, f.name || "issue.jpg", "field-issues"), type: "image/jpeg" });
  const issue = await prisma.fieldIssue.create({ data: { projectId, crewId: crew.crewId, reportedBy: crew.name, note: note.trim(), photos } });
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { salespersonId: true, estimatorId: true } });
  await prisma.task.create({
    data: { projectId, title: `Crew found an issue: ${note.trim().slice(0, 140)} — price it or mark no charge`, assigneeId: p.salespersonId ?? p.estimatorId, dueDate: new Date(), auto: `ISSUE:${issue.id}`, createdBy: crew.name },
  });
  await crewNotice(projectId, `${crew.name} reported an issue: ${note.trim().slice(0, 200)}`);
  return issue;
}

export async function resolveIssue(id: string, status: "PRICED" | "NO_CHARGE", resolution: string | null, actor: Actor) {
  const i = await prisma.fieldIssue.update({ where: { id }, data: { status, resolution: resolution?.trim() || null, resolvedBy: actor.name, resolvedAt: new Date() } });
  await prisma.task.updateMany({ where: { auto: `ISSUE:${id}`, doneAt: null }, data: { doneAt: new Date(), doneBy: actor.name } });
  await prisma.projectActivity.create({ data: { projectId: i.projectId, userId: actor.id, kind: "production", text: `${actor.name} ${status === "PRICED" ? "priced" : "marked no charge"} the crew's issue: ${i.note}${resolution ? ` — ${resolution}` : ""}` } });
  return i;
}

// ---------- extra-work (T&M) tags ----------
// Research (docs/growth-research.md): unpriced field extras are the biggest quiet margin leak for specialty
// contractors — a signed tag takes ~3 weeks to become a priced change order on paper, ~3.5 days when it's
// captured digitally on site. So: crew logs it with hours, materials, photos and the super's signature;
// the office prices it into a change order from the tag; the extras desk ages everything not yet approved.

export type ExtraInput = {
  note: string;
  workDate: Date | null;
  men: number | null;
  hours: number | null;
  materials: string | null;
  directedBy: string | null;
  signerName: string | null;
  signatureImage: string | null;
};

export async function logExtraWork(crew: { crewId: string; name: string }, projectId: string, x: ExtraInput, files: { bytes: Uint8Array; name: string }[]) {
  if (!x.note.trim()) throw new FieldError("Say what the extra work was (e.g. replaced 6 sheets of rotted decking, back slope).");
  if (x.hours != null && (!Number.isFinite(x.hours) || x.hours < 0 || x.hours > 500)) throw new FieldError("Enter total man-hours as a number.");
  if (x.men != null && (!Number.isInteger(x.men) || x.men < 0 || x.men > 50)) throw new FieldError("Enter how many workers as a whole number.");
  if (x.signatureImage && (!x.signatureImage.startsWith("data:image/png;base64,") || x.signatureImage.length > 400_000)) throw new FieldError("The signature didn't come through. Clear it and sign again.");
  if (x.signatureImage && !x.signerName?.trim()) throw new FieldError("Type the name of the person who signed.");
  if (!files.length && !x.signatureImage) throw new FieldError("Add a photo or get the super's signature — the office needs proof to bill it.");
  const assigned = (await prisma.scheduleEvent.findFirst({ where: { projectId, crewId: crew.crewId } })) ?? (await prisma.workOrder.findFirst({ where: { projectId, crewId: crew.crewId } }));
  if (!assigned) throw new FieldError("That job isn't assigned to your crew.");
  const photos = [];
  for (const f of files.slice(0, 8)) photos.push({ url: await saveUpload(f.bytes, f.name || "extra.jpg", "field-issues"), type: "image/jpeg" });
  const tag = await prisma.fieldIssue.create({
    data: {
      projectId,
      crewId: crew.crewId,
      reportedBy: crew.name,
      kind: "EXTRA",
      note: x.note.trim(),
      photos,
      workDate: x.workDate ?? new Date(),
      men: x.men,
      hours: x.hours,
      materials: x.materials?.trim() || null,
      directedBy: x.directedBy?.trim() || null,
      signerName: x.signatureImage ? x.signerName!.trim() : null,
      signatureImage: x.signatureImage,
      signedAt: x.signatureImage ? new Date() : null,
    },
  });
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { salespersonId: true, estimatorId: true } });
  await prisma.task.create({
    data: { projectId, title: `Extra work tag from ${crew.name}: ${x.note.trim().slice(0, 120)} — price it into a change order`, assigneeId: p.salespersonId ?? p.estimatorId, dueDate: new Date(), auto: `ISSUE:${tag.id}`, createdBy: crew.name },
  });
  await crewNotice(projectId, `${crew.name} logged extra work${tag.signerName ? ` signed by ${tag.signerName}` : ""}: ${x.note.trim().slice(0, 200)}`);
  return tag;
}

/** Plain-English summary of a tag, used as the change order description. */
export function tagSummary(t: { note: string; workDate: Date | null; createdAt: Date; men: number | null; hours: number | null; materials: string | null; directedBy: string | null; signerName: string | null; reportedBy: string }) {
  const d = (t.workDate ?? t.createdAt).toISOString().slice(0, 10);
  const parts = [`Field tag ${d} (${t.reportedBy})${t.directedBy ? `, directed by ${t.directedBy}` : ""}: ${t.note}`];
  if (t.men || t.hours) parts.push(`Labor: ${t.men ? `${t.men} workers` : ""}${t.men && t.hours ? ", " : ""}${t.hours ? `${t.hours} man-hours` : ""}`);
  if (t.materials) parts.push(`Materials: ${t.materials}`);
  if (t.signerName) parts.push(`Signed on site by ${t.signerName}`);
  return parts.join(". ");
}

/** Turns a tag (or a found-on-site issue) into a pending change order and links the two. */
export async function priceTag(id: string, input: { amount: number; costImpact: number | null; description: string | null }, actor: Actor) {
  const t = await prisma.fieldIssue.findUniqueOrThrow({ where: { id } });
  if (t.changeOrderId) throw new FieldError("This tag already has a change order.");
  const co = await addChangeOrder(t.projectId, { kind: "CHANGE_ORDER", description: input.description?.trim() || tagSummary(t), amount: input.amount, costImpact: input.costImpact, source: `Field tag by ${t.reportedBy}` }, actor);
  await prisma.fieldIssue.update({ where: { id }, data: { status: "PRICED", changeOrderId: co.id, resolution: `${co.number} — $${co.amount.toFixed(2)}`, resolvedBy: actor.name, resolvedAt: new Date() } });
  await prisma.task.updateMany({ where: { auto: `ISSUE:${id}`, doneAt: null }, data: { doneAt: new Date(), doneBy: actor.name } });
  return co;
}

const DAY = 86_400_000;
export type ExtraRow = { id: string; projectId: string; job: string; kind: string; note: string; crew: string; date: Date; days: number; signed: boolean; hours: number | null; stage: "UNPRICED" | "AWAITING_SIGNATURE"; co?: { number: string; amount: number; sentAt: Date | null } };

/** Every field extra not yet turned into approved money, oldest first. */
export async function extrasDesk(now = new Date()) {
  const [open, priced] = await Promise.all([
    prisma.fieldIssue.findMany({ where: { status: "OPEN" }, include: { project: { select: { name: true } } } }),
    prisma.fieldIssue.findMany({ where: { status: "PRICED", changeOrderId: { not: null } }, include: { project: { select: { name: true } } } }),
  ]);
  const cos = await prisma.changeOrder.findMany({ where: { id: { in: priced.map((p) => p.changeOrderId!) }, status: "PENDING" }, select: { id: true, number: true, amount: true, sentAt: true } });
  const coBy = new Map(cos.map((c) => [c.id, c]));
  const row = (t: (typeof open)[number], stage: ExtraRow["stage"]): ExtraRow => {
    const date = t.workDate ?? t.createdAt;
    const c = t.changeOrderId ? coBy.get(t.changeOrderId) : undefined;
    return { id: t.id, projectId: t.projectId, job: t.project.name, kind: t.kind ?? "ISSUE", note: t.note, crew: t.reportedBy, date, days: Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY)), signed: !!t.signedAt, hours: t.hours, stage, co: c && { number: c.number, amount: c.amount, sentAt: c.sentAt } };
  };
  const rows = [...open.map((t) => row(t, "UNPRICED")), ...priced.filter((t) => coBy.has(t.changeOrderId!)).map((t) => row(t, "AWAITING_SIGNATURE"))].sort((a, b) => b.days - a.days);
  const unpriced = rows.filter((r) => r.stage === "UNPRICED");
  const waiting = rows.filter((r) => r.stage === "AWAITING_SIGNATURE");
  return {
    rows,
    unpriced: unpriced.length,
    oldestUnpriced: unpriced[0]?.days ?? null,
    waitingAmount: Math.round(waiting.reduce((a, r) => a + (r.co?.amount ?? 0), 0) * 100) / 100,
    buckets: { week: rows.filter((r) => r.days <= 7).length, month: rows.filter((r) => r.days > 7 && r.days <= 30).length, older: rows.filter((r) => r.days > 30).length },
  };
}
