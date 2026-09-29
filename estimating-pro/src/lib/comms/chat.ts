// Per-job internal chat.
import { prisma } from "@/lib/db";

export const MAX_MESSAGE = 5000;

/** Finds @mentions of users: "@Trevin", "@Trevin Smith", or "@trevin@btrcontracting.com". */
export function findMentions(body: string, users: { id: string; name: string; email: string }[]) {
  const lower = body.toLowerCase();
  const ids = new Set<string>();
  for (const u of users) {
    const first = u.name.split(/\s+/)[0]?.toLowerCase();
    const candidates = [u.name.toLowerCase(), u.email.toLowerCase(), first].filter(Boolean) as string[];
    for (const c of candidates) {
      const re = new RegExp(`(^|\\s)@${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`);
      if (re.test(lower)) ids.add(u.id);
    }
  }
  return [...ids];
}

export async function postMessage(projectId: string, authorId: string, body: string, parentId?: string | null) {
  const text = body.trim();
  if (!text) throw new Error("Message is empty.");
  if (text.length > MAX_MESSAGE) throw new Error(`Keep messages under ${MAX_MESSAGE} characters.`);
  if (parentId) {
    const parent = await prisma.jobMessage.findUnique({ where: { id: parentId } });
    if (!parent || parent.projectId !== projectId) throw new Error("Replying to a message on another job.");
  }
  const users = await prisma.user.findMany({ select: { id: true, name: true, email: true } });
  const mentions = findMentions(text, users).filter((id) => id !== authorId);
  const msg = await prisma.jobMessage.create({
    data: { projectId, authorId, body: text, parentId: parentId ?? null, mentions },
  });
  await markChatRead(projectId, authorId);
  return msg;
}

export async function editMessage(id: string, userId: string, body: string) {
  const msg = await prisma.jobMessage.findUniqueOrThrow({ where: { id } });
  if (msg.authorId !== userId) throw new Error("You can only edit your own messages.");
  const text = body.trim();
  if (!text) throw new Error("Message is empty.");
  return prisma.jobMessage.update({ where: { id }, data: { body: text, editedAt: new Date() } });
}

export async function listMessages(projectId: string, after?: Date) {
  return prisma.jobMessage.findMany({
    where: { projectId, ...(after ? { OR: [{ createdAt: { gt: after } }, { editedAt: { gt: after } }] } : {}) },
    include: { author: { select: { id: true, name: true } }, parent: { select: { id: true, body: true, author: { select: { name: true } } } } },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
}

export async function markChatRead(projectId: string, userId: string) {
  await prisma.projectView.upsert({
    where: { projectId_userId: { projectId, userId } },
    update: { chatReadAt: new Date() },
    create: { projectId, userId, chatReadAt: new Date() },
  });
}

/** Unread chat messages per project for this user (messages by others since they last read the chat). */
export async function unreadCounts(userId: string, projectIds: string[]): Promise<Record<string, { unread: number; mentioned: boolean }>> {
  if (!projectIds.length) return {};
  const views = await prisma.projectView.findMany({ where: { userId, projectId: { in: projectIds } } });
  const readAt = new Map(views.map((v) => [v.projectId, v.chatReadAt]));
  const msgs = await prisma.jobMessage.findMany({
    where: { projectId: { in: projectIds }, authorId: { not: userId } },
    select: { projectId: true, createdAt: true, mentions: true },
  });
  const out: Record<string, { unread: number; mentioned: boolean }> = {};
  for (const m of msgs) {
    const r = readAt.get(m.projectId);
    if (r && m.createdAt <= r) continue;
    const o = (out[m.projectId] ??= { unread: 0, mentioned: false });
    o.unread++;
    if (Array.isArray(m.mentions) && (m.mentions as string[]).includes(userId)) o.mentioned = true;
  }
  return out;
}
