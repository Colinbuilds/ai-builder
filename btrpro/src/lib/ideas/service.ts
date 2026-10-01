// Team ideas: anyone on staff adds what slows them down; owners/admins set the status and reply.
import { prisma } from "@/lib/db";

export const OFTEN = { DAILY: "Every day", WEEKLY: "Every week", MONTHLY: "Every month", RARELY: "Now and then" } as const;
export const STATUS = { NEW: "New", PLANNED: "Planned", BUILDING: "Being built", DONE: "Done — live", NOT_NOW: "Not right now" } as const;
export const AREAS = ["Leads & sales", "Estimating", "Scheduling", "Material orders", "Crews", "Invoicing & payments", "QuickBooks", "Change orders / VPOs", "Reports", "Something else"] as const;
const WEIGHT: Record<string, number> = { DAILY: 20, WEEKLY: 4, MONTHLY: 1, RARELY: 0.25 };

export class IdeaError extends Error {}
type Actor = { id: string; name: string };

export async function addIdea(i: { title: string; details: string; often: string; minutes: number | null; area: string | null }, a: Actor) {
  if (!i.title.trim()) throw new IdeaError("Give the idea a short title.");
  if (i.details.trim().length < 10) throw new IdeaError("Say a little more: what do you do today, and what would make it faster?");
  return prisma.idea.create({
    data: { title: i.title.trim().slice(0, 140), details: i.details.trim().slice(0, 4000), often: i.often in OFTEN ? i.often : "WEEKLY", minutes: i.minutes, area: i.area, createdById: a.id, createdBy: a.name, votes: [a.id] },
  });
}

export async function toggleVote(id: string, a: Actor) {
  const i = await prisma.idea.findUniqueOrThrow({ where: { id } });
  const v = (i.votes as string[]) ?? [];
  await prisma.idea.update({ where: { id }, data: { votes: v.includes(a.id) ? v.filter((x) => x !== a.id) : [...v, a.id] } });
}

export async function setIdeaStatus(id: string, status: string, reply: string | null) {
  if (!(status in STATUS)) throw new IdeaError("Unknown status.");
  await prisma.idea.update({ where: { id }, data: { status, reply: reply?.trim() || null, doneAt: status === "DONE" ? new Date() : null } });
}

/** Estimated hours a month it would give back: how often × minutes × people who want it. */
export const hoursPerMonth = (i: { often: string; minutes: number | null; votes: unknown }) =>
  i.minutes ? Math.round(((WEIGHT[i.often] ?? 1) * i.minutes * Math.max(1, (i.votes as string[]).length)) / 6) / 10 : null;

/** Plain-text list of open ideas, to paste to Claude to build. */
export async function ideasForClaude() {
  const open = await prisma.idea.findMany({ where: { status: { in: ["NEW", "PLANNED"] } }, orderBy: { createdAt: "asc" } });
  return [
    `BTRpro team ideas — ${open.length} open (${new Date().toISOString().slice(0, 10)})`,
    "",
    ...open.map((i, n) => `${n + 1}. [${i.id}] ${i.title}\n   From: ${i.createdBy} · ${i.area ?? "—"} · ${OFTEN[i.often as keyof typeof OFTEN] ?? i.often}${i.minutes ? ` · saves ~${i.minutes} min each time` : ""} · ${(i.votes as string[]).length} want it\n   ${i.details.replace(/\n/g, "\n   ")}`),
  ].join("\n");
}
