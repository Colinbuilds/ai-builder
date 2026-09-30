import { prisma } from "@/lib/db";

/** Records that a user opened a job (for the Recent menu) without touching their chat read time. */
export async function touchJob(projectId: string, userId: string) {
  const now = new Date();
  await prisma.projectView.upsert({
    where: { projectId_userId: { projectId, userId } },
    update: { lastViewedAt: now },
    // a first visit must not mark the chat read, so unread messages still show
    create: { projectId, userId, chatReadAt: new Date(0), lastViewedAt: now },
  });
}

export async function recentJobs(userId: string, take = 12) {
  const v = await prisma.projectView.findMany({
    where: { userId, lastViewedAt: { not: null } },
    include: { project: { select: { id: true, name: true, address: true, status: true } } },
    orderBy: { lastViewedAt: "desc" },
    take,
  });
  return v.map((x) => x.project);
}
