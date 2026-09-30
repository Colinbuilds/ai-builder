"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export type SResult = { problems: string[]; ok?: boolean } | null;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function markNotificationsSeen() {
  const u = await requireUser();
  await prisma.user.update({ where: { id: u.id }, data: { notificationsSeenAt: new Date() } });
  revalidatePath("/", "layout");
}

export async function toggleWatchAction(f: FormData) {
  const u = await requireUser();
  const projectId = str(f, "projectId");
  const existing = await prisma.jobWatch.findUnique({ where: { projectId_userId: { projectId, userId: u.id } } });
  if (existing) await prisma.jobWatch.delete({ where: { id: existing.id } });
  else await prisma.jobWatch.create({ data: { projectId, userId: u.id } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function setPriorityAction(f: FormData) {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  const projectId = str(f, "projectId");
  const priority = str(f, "priority") === "HIGH" ? "HIGH" : "NORMAL";
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { priority: true } });
  if (p.priority === priority) return;
  await prisma.project.update({ where: { id: projectId }, data: { priority } });
  await prisma.projectActivity.create({ data: { projectId, userId: u.id, kind: "details", text: `${u.name} set the priority to ${priority === "HIGH" ? "High" : "Normal"}` } });
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function postUpdateAction(_: SResult, f: FormData): Promise<SResult> {
  const u = await requireUser(["ADMIN"]);
  const title = str(f, "title");
  const body = str(f, "body");
  if (!title) return { problems: ["Give the update a headline."] };
  if (title.length > 200 || body.length > 10_000) return { problems: ["That update is too long."] };
  await prisma.companyUpdate.create({ data: { title, body, pinned: f.get("pinned") === "on", authorId: u.id } });
  revalidatePath("/", "layout");
  return { problems: [], ok: true };
}

export async function deleteUpdateAction(f: FormData) {
  await requireUser(["ADMIN"]);
  await prisma.companyUpdate.deleteMany({ where: { id: str(f, "id") } });
  revalidatePath("/", "layout");
}

export async function pinUpdateAction(f: FormData) {
  await requireUser(["ADMIN"]);
  const id = str(f, "id");
  const x = await prisma.companyUpdate.findUniqueOrThrow({ where: { id } });
  await prisma.companyUpdate.update({ where: { id }, data: { pinned: !x.pinned } });
  revalidatePath("/", "layout");
}
