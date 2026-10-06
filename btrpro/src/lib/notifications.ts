// What shows in the top bar and the notifications panel: activity and chat on the jobs a user is on
// (salesperson, estimator, or watching), @mentions, tasks due, and company updates.
import { prisma } from "@/lib/db";
import { prettyStages, stageMoveTitle } from "@/lib/projects/milestones";
import { exemptForm } from "@/lib/company-profile";

export type Note = {
  id: string;
  kind: "activity" | "message" | "mention" | "update" | "task";
  at: Date;
  title: string;
  text: string;
  href: string;
  by: string | null;
  job: string | null;
  stage: string | null;
};

const DAY = 86_400_000;

export async function myJobIds(userId: string) {
  const [own, watched] = await Promise.all([
    prisma.project.findMany({ where: { OR: [{ salespersonId: userId }, { estimatorId: userId }] }, select: { id: true } }),
    prisma.jobWatch.findMany({ where: { userId }, select: { projectId: true } }),
  ]);
  return [...new Set([...own.map((p) => p.id), ...watched.map((w) => w.projectId)])];
}

const mentionsMe = (m: unknown, userId: string) => Array.isArray(m) && (m as string[]).includes(userId);

/** Unread @mentions: chat messages naming this user, newer than when they last read that job's chat. */
export async function unreadMentions(userId: string) {
  const msgs = await prisma.jobMessage.findMany({
    where: { authorId: { not: userId }, createdAt: { gt: new Date(Date.now() - 60 * DAY) } },
    select: { id: true, projectId: true, createdAt: true, mentions: true },
  });
  const mine = msgs.filter((m) => mentionsMe(m.mentions, userId));
  if (!mine.length) return [];
  const views = await prisma.projectView.findMany({ where: { userId, projectId: { in: [...new Set(mine.map((m) => m.projectId))] } } });
  const readAt = new Map(views.map((v) => [v.projectId, v.chatReadAt]));
  return mine.filter((m) => !readAt.has(m.projectId) || m.createdAt > readAt.get(m.projectId)!);
}

export async function tasksDue(userId: string) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return prisma.task.count({ where: { assigneeId: userId, doneAt: null, dueDate: { lte: end } } });
}

/** Everything for the notifications panel, newest first. */
export async function notificationFeed(userId: string, limit = 60): Promise<Note[]> {
  const since = new Date(Date.now() - 30 * DAY);
  const jobs = await myJobIds(userId);
  const [activity, messages, updates, tasks] = await Promise.all([
    prisma.projectActivity.findMany({
      where: { projectId: { in: jobs }, createdAt: { gt: since }, OR: [{ userId: null }, { userId: { not: userId } }] },
      include: { user: { select: { name: true } }, project: { select: { name: true, status: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.jobMessage.findMany({
      where: { authorId: { not: userId }, createdAt: { gt: since } },
      include: { author: { select: { name: true } }, project: { select: { name: true, status: true } } },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    prisma.companyUpdate.findMany({ where: { createdAt: { gt: since } }, include: { author: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.task.findMany({
      where: { assigneeId: userId, doneAt: null, dueDate: { lte: new Date(Date.now() + DAY) } },
      include: { project: { select: { id: true, name: true, status: true } } },
      orderBy: { dueDate: "asc" },
      take: 20,
    }),
  ]);
  const jobSet = new Set(jobs);
  const notes: Note[] = [
    ...activity.map((a) => ({
      id: `a:${a.id}`,
      kind: "activity" as const,
      at: a.createdAt,
      title: (a.kind === "stage" && stageMoveTitle(a.data)) || activityTitle(a.kind),
      text: prettyStages(a.text),
      href: `/projects/${a.projectId}`,
      by: a.user?.name ?? null,
      job: a.project.name,
      stage: a.project.status,
    })),
    ...messages
      .filter((m) => jobSet.has(m.projectId) || mentionsMe(m.mentions, userId))
      .map((m) => {
        const mention = mentionsMe(m.mentions, userId);
        return {
          id: `m:${m.id}`,
          kind: mention ? ("mention" as const) : ("message" as const),
          at: m.createdAt,
          title: mention ? "Mentioned you" : "Message",
          text: m.body.length > 200 ? `${m.body.slice(0, 200)}…` : m.body,
          href: `/projects/${m.projectId}/chat`,
          by: m.author.name,
          job: m.project.name,
          stage: m.project.status,
        };
      }),
    ...updates.map((u) => ({
      id: `u:${u.id}`,
      kind: "update" as const,
      at: u.createdAt,
      title: "Company update",
      text: u.title,
      href: `/updates#${u.id}`,
      by: u.author.name,
      job: null,
      stage: null,
    })),
    ...tasks.map((t) => ({
      id: `t:${t.id}`,
      kind: "task" as const,
      at: t.dueDate ?? t.createdAt,
      title: t.dueDate && t.dueDate < new Date() ? "Task due" : "Task due soon",
      text: t.title,
      href: t.project ? `/projects/${t.project.id}` : "/today",
      by: null,
      job: t.project?.name ?? null,
      stage: t.project?.status ?? null,
    })),
  ];
  return notes.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

export function activityTitle(kind: string) {
  return (
    ({
      created: "New lead",
      stage: "Job moved",
      intake: "Intake updated",
      form17: exemptForm().short,
      details: "Job updated",
      contact: "Contact",
      override: "Override",
      import: "Imported",
      proposal: "Proposal",
      invoice: "Invoice",
      payment: "Payment",
      order: "Order",
      comment: "Comment",
    } as Record<string, string>)[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1)
  );
}

/** Counts for the top bar. */
export async function topBarCounts(userId: string) {
  const [user, mentions, tasks] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { notificationsSeenAt: true } }),
    unreadMentions(userId),
    tasksDue(userId),
  ]);
  const seen = user?.notificationsSeenAt ?? new Date(0);
  const feed = await notificationFeed(userId, 100);
  const { newBidCount } = await import("@/lib/bids/service");
  const bids = await newBidCount().catch(() => 0);
  // website requests nobody has assigned yet (everyone sees it; the sales manager also gets a task)
  const webLeads = await prisma.webLead.count({ where: { status: "NEW" } });
  return { bell: feed.filter((n) => n.at > seen && n.kind !== "task").length, mentions: mentions.length, tasks, bids, webLeads };
}
