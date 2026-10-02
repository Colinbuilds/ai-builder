import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { STAFF_ROLES } from "@/lib/roles";
import { AREAS, reviewDue, type Area } from "@/lib/playbook/service";
import { Markdown } from "@/components/markdown";
import { SopForm } from "@/components/playbook/sop-form";
import { deleteSopAction, reviewedAction } from "../actions";

export default async function SopPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const u = await requireUser(STAFF_ROLES);
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const s = await prisma.sop.findUnique({ where: { id } });
  if (!s) notFound();
  const r = reviewDue(s);
  const people = await prisma.user.findMany({ where: { role: { not: "VIEWER" } }, select: { name: true }, orderBy: { name: "asc" } });
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Link href="/playbook" className="text-sm text-btr-link hover:underline">
        ← Playbook
      </Link>
      {sp.edit ? (
        <SopForm sop={s} areas={Object.entries(AREAS)} people={people.map((p) => p.name)} />
      ) : (
        <>
          <div>
            <h1 className="text-2xl font-semibold">{s.title}</h1>
            <p className="text-sm text-muted-foreground">
              {AREAS[s.area as Area] ?? s.area} · owner {s.ownerName ?? "not set"} · {s.draft ? "draft" : `reviewed ${s.reviewedAt?.toISOString().slice(0, 10)} by ${s.reviewedBy}`} · next review{" "}
              {r.due.toISOString().slice(0, 10)}
              {r.overdue && !s.draft && <b className="text-red-700"> (due)</b>}
            </p>
          </div>
          <article className="prose-sm rounded-lg border bg-background p-4 text-sm">
            <Markdown text={s.body} />
          </article>
          <div className="flex flex-wrap gap-2">
            <Link href={`/playbook/${s.id}?edit=1`} className="rounded-md border px-3 py-2 text-sm hover:bg-muted">
              Edit
            </Link>
            <form action={reviewedAction}>
              <input type="hidden" name="id" value={s.id} />
              <button className="rounded-md bg-btr-blue px-3 py-2 text-sm text-white hover:bg-btr-blue-dark">Still how we do it — mark reviewed</button>
            </form>
            {u.role === "ADMIN" && (
              <form action={deleteSopAction}>
                <input type="hidden" name="id" value={s.id} />
                <button className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:underline">Delete</button>
              </form>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Last edited by {s.updatedBy} on {s.updatedAt.toISOString().slice(0, 10)}.</p>
        </>
      )}
    </div>
  );
}
