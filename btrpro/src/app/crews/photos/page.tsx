import { BILLING_ROLES } from "@/lib/roles";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/** Jobs with crew photos the office hasn't checked yet (quality of work and cleanup). */
export default async function CrewPhotosToCheck() {
  await requireUser(BILLING_ROLES);
  const groups = await prisma.jobPhoto.groupBy({ by: ["projectId", "crewId"], where: { review: "PENDING", crewId: { not: null } }, _count: true, _max: { takenAt: true } });
  const [projects, crews] = await Promise.all([
    prisma.project.findMany({ where: { id: { in: groups.map((g) => g.projectId) } }, select: { id: true, name: true, address: true } }),
    prisma.crew.findMany({ where: { id: { in: groups.map((g) => g.crewId!) } }, select: { id: true, name: true } }),
  ]);
  const rows = groups.sort((a, b) => (b._max.takenAt?.getTime() ?? 0) - (a._max.takenAt?.getTime() ?? 0));
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Crew photos to check</h1>
        <p className="text-sm text-muted-foreground">Open a job, look over the photos for quality of work and site cleanup, and mark each OK or flag an issue.</p>
      </div>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">All caught up.</p>}
      <ul className="divide-y rounded-lg border border-btr-line">
        {rows.map((g) => {
          const p = projects.find((x) => x.id === g.projectId);
          return (
            <li key={`${g.projectId}-${g.crewId}`}>
              <Link href={`/projects/${g.projectId}/photos#crew`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50">
                <span className="flex-1">
                  <span className="font-medium">{p?.name}</span>
                  {p?.address && <span className="text-muted-foreground"> · {p.address}</span>}
                  <span className="block text-muted-foreground">{crews.find((c) => c.id === g.crewId)?.name}</span>
                </span>
                <span className="rounded-full bg-btr-blue px-2.5 py-0.5 text-xs font-semibold text-white">{g._count} to check</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
