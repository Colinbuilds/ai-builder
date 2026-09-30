// Deleting jobs (Admin only). Everything on the job goes with it: estimates, documents, chat, email, costs,
// orders, schedule, invoices, tasks. Jobs with money already received (or synced to QuickBooks) are kept:
// those are accounting records, so they're marked Lost/Closed instead.
import { prisma } from "@/lib/db";

type Actor = { id: string; name: string; role: string };
export class DeleteError extends Error {}

/** Why a job can't be deleted, or null if it can. */
export async function deleteBlocker(projectId: string): Promise<string | null> {
  const [payments, synced] = await Promise.all([
    prisma.payment.count({ where: { invoice: { projectId } } }),
    prisma.invoice.count({ where: { projectId, qboId: { not: null } } }),
  ]);
  if (payments)
    return `${payments} payment${payments === 1 ? " is" : "s are"} recorded on this job. Move it to Closed or Lost instead (an Admin can remove payments first if they were entered by mistake).`;
  if (synced)
    return "Invoices on this job were sent to QuickBooks. Void them there and move the job to Closed or Lost instead.";
  return null;
}

async function removeOne(projectId: string, actor: Actor) {
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      clientCompany: { select: { name: true } },
      _count: {
        select: {
          estimates: true,
          documents: true,
          invoices: true,
          costs: true,
        },
      },
    },
  });
  if (!p)
    throw new DeleteError(
      "That job doesn't exist (it may already be deleted).",
    );
  const blocked = await deleteBlocker(projectId);
  if (blocked) throw new DeleteError(`${p.name}: ${blocked}`);
  // records keyed by projectId without a database relation
  await prisma.assistantMessage.deleteMany({ where: { projectId } });
  await prisma.proposal.deleteMany({ where: { projectId } });
  await prisma.project.delete({ where: { id: projectId } });
  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      entity: "Project",
      entityId: projectId,
      action: "delete",
      before: {
        name: p.name,
        address: p.address,
        status: p.status,
        market: p.market,
        client: p.clientCompany?.name ?? null,
        contractAmount: p.contractAmount,
        importKey: p.importKey,
        counts: p._count,
      },
    },
  });
  return p.name;
}

/** Deletes one job. The Admin types the job's name to confirm. */
export async function deleteProject(
  projectId: string,
  confirmName: string,
  actor: Actor,
) {
  if (actor.role !== "ADMIN")
    throw new DeleteError("Only an Admin can delete jobs.");
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true },
  });
  if (!p) throw new DeleteError("That job doesn't exist.");
  if (confirmName.trim().toLowerCase() !== p.name.trim().toLowerCase())
    throw new DeleteError("Type the job's name exactly to confirm.");
  return removeOne(projectId, actor);
}

/** Deletes several jobs; ones that can't be deleted are skipped with the reason. */
export async function deleteProjects(ids: string[], actor: Actor) {
  if (actor.role !== "ADMIN")
    throw new DeleteError("Only an Admin can delete jobs.");
  const deleted: string[] = [];
  const skipped: string[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      deleted.push(await removeOne(id, actor));
    } catch (e) {
      skipped.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { deleted, skipped };
}
