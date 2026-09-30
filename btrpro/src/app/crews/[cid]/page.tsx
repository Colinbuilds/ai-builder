import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { compliance } from "@/lib/production/rules";
import { CrewForm } from "@/components/production/forms";
import { ComplianceBadge } from "@/components/production/compliance-badge";
import { formatDate } from "@/lib/utils";

export default async function CrewPage({ params }: { params: Promise<{ cid: string }> }) {
  const user = await requireUser(["ADMIN", "ESTIMATOR"]);
  const crew = await prisma.crew.findUnique({
    where: { id: (await params).cid },
    include: {
      events: { where: { endDate: { gte: new Date(Date.now() - 86_400_000) }, status: { not: "CANCELLED" } }, include: { project: { select: { id: true, name: true } } }, orderBy: { startDate: "asc" }, take: 20 },
      workOrders: { include: { project: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!crew) notFound();
  return (
    <div className="flex flex-col gap-5">
      <Link href="/crews" className="text-sm text-muted-foreground">
        ← Crews &amp; subs
      </Link>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{crew.name}</h1>
        <ComplianceBadge c={compliance(crew, new Date())} />
      </div>
      <CrewForm crew={crew} />
      <section>
        <h2 className="font-semibold">Upcoming</h2>
        {crew.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
        ) : (
          crew.events.map((e) => (
            <p key={e.id} className="text-sm">
              {formatDate(e.startDate)}
              {e.endDate.getTime() !== e.startDate.getTime() && ` – ${formatDate(e.endDate)}`} · {e.title}
              {e.project && (
                <>
                  {" · "}
                  <Link href={`/projects/${e.project.id}/production`} className="underline">
                    {e.project.name}
                  </Link>
                </>
              )}
            </p>
          ))
        )}
      </section>
      <section>
        <h2 className="font-semibold">Work orders</h2>
        {crew.workOrders.map((w) => (
          <p key={w.id} className="text-sm">
            {w.number} · {w.status.toLowerCase().replace("_", " ")} ·{" "}
            <Link href={`/projects/${w.project.id}/production`} className="underline">
              {w.project.name}
            </Link>
            {user.role === "ADMIN" && w.amount != null && ` · $${w.amount.toFixed(2)}`}
          </p>
        ))}
      </section>
    </div>
  );
}
