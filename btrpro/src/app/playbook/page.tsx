import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { STAFF_ROLES } from "@/lib/roles";
import { AREAS, reviewDue, type Area } from "@/lib/playbook/service";
import { SopForm } from "@/components/playbook/sop-form";
import { startersAction } from "./actions";

export default async function Playbook() {
  const u = await requireUser(STAFF_ROLES);
  const [sops, people] = await Promise.all([prisma.sop.findMany({ orderBy: { title: "asc" } }), prisma.user.findMany({ where: { role: { not: "VIEWER" } }, select: { name: true }, orderBy: { name: "asc" } })]);
  const rows = sops.map((s) => ({ ...s, ...reviewDue(s) }));
  const overdue = rows.filter((r) => r.overdue);
  const noOwner = rows.filter((r) => !r.ownerName);
  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Playbook</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            How BTR does its repeat work, step by step. A process that lives in one person&apos;s head breaks the day they&apos;re out — and keeps the owners in the middle of every decision. Each
            procedure has an owner who confirms it still matches the work on a schedule.
          </p>
        </div>
        {(u.role === "ADMIN" || u.role === "OFFICE") && (
          <form action={startersAction}>
            <button className="rounded-md border px-3 py-2 text-sm hover:bg-muted">Add starter drafts</button>
          </form>
        )}
      </div>
      {rows.length > 0 && (overdue.length > 0 || noOwner.length > 0) && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
          {overdue.length} need{overdue.length === 1 ? "s" : ""} review (drafts or past their review date) · {noOwner.length} without an owner.
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {(Object.keys(AREAS) as Area[]).map((a) => {
            const xs = rows.filter((r) => r.area === a);
            if (!xs.length) return null;
            return (
              <section key={a} className="rounded-lg border bg-background p-3">
                <h2 className="font-semibold">{AREAS[a]}</h2>
                <ul className="mt-1 divide-y text-sm">
                  {xs.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 py-1.5">
                      <Link href={`/playbook/${s.id}`} className="text-btr-link hover:underline">
                        {s.title}
                      </Link>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {s.ownerName ?? <span className="text-amber-800">no owner</span>} ·{" "}
                        {s.draft ? <span className="text-amber-800">draft</span> : s.overdue ? <span className="text-red-700">review due</span> : `reviewed ${s.reviewedAt?.toISOString().slice(0, 10)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {!rows.length && <p className="text-sm text-muted-foreground">Nothing written down yet. Start with the starter drafts, or write the process people ask about most.</p>}
        </div>
        <section className="rounded-lg border bg-background p-3">
          <h2 className="mb-2 font-semibold">New procedure</h2>
          <SopForm sop={null} areas={Object.entries(AREAS)} people={people.map((p) => p.name)} />
        </section>
      </div>
    </div>
  );
}
