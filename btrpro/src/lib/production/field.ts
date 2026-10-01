// Production follow-through: ready-to-schedule checklist (warnings, never a block), punch list, and
// crew-reported field issues.
import { prisma } from "@/lib/db";
import { saveUpload } from "@/lib/storage";
import { crewNotice } from "@/lib/crew/notice";
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
