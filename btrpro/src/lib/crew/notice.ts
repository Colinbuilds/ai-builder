// Crew updates (started on site, finished, found a problem) go on the job's activity. No texts.
import { prisma } from "@/lib/db";

export async function crewNotice(projectId: string, text: string) {
  await prisma.projectActivity.create({ data: { projectId, kind: "crew", text } });
}
