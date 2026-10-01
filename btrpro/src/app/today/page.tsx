import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { reminders } from "@/lib/tasks/service";
import { TaskItem, type TaskRow } from "@/components/tasks/task-list";
import { AddTask } from "@/components/tasks/add-task";
import { Badge } from "@/components/ui/badge";

const DAY = 86_400_000;
const GROUPS = [
  "Overdue",
  "Today",
  "This week",
  "Later",
  "No due date",
] as const;
function group(t: TaskRow, now: Date): (typeof GROUPS)[number] {
  if (!t.dueDate) return "No due date";
  const start = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const due = Date.UTC(
    t.dueDate.getUTCFullYear(),
    t.dueDate.getUTCMonth(),
    t.dueDate.getUTCDate(),
  );
  if (due < start) return "Overdue";
  if (due === start) return "Today";
  if (due - start <= 7 * DAY) return "This week";
  return "Later";
}

export default async function MyDay({
  searchParams,
}: {
  searchParams: Promise<{ who?: string }>;
}) {
  const user = await requireUser();
  const { who } = await searchParams;
  const admin = user.role === "ADMIN";
  const view = admin && (who === "all" || who === "unassigned") ? who : "me";
  const canEdit = user.role !== "VIEWER";
  const now = new Date();
  const [tasks, users, jobs, rem] = await Promise.all([
    prisma.task.findMany({
      where: {
        doneAt: null,
        ...(view === "me"
          ? { assigneeId: user.id }
          : view === "unassigned"
            ? { assigneeId: null }
            : {}),
      },
      include: {
        assignee: { select: { name: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: [
        { dueDate: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
      ],
      take: 500,
    }),
    prisma.user.findMany({
      where: { role: { not: "VIEWER" } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({
      where: { status: { notIn: ["CLOSED", "LOST", "PAID"] } },
      select: { id: true, name: true },
      orderBy: { updatedAt: "desc" },
      take: 300,
    }),
    reminders(user, now),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">My day</h1>
          <p className="text-sm text-muted-foreground">
            {now.toLocaleDateString("en-US", {
              timeZone: "America/Chicago",
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
        {admin && (
          <div className="flex gap-2 text-sm">
            {[
              ["me", "My tasks"],
              ["unassigned", "Unassigned"],
              ["all", "Everyone's"],
            ].map(([v, l]) => (
              <Link
                key={v}
                href={v === "me" ? "/today" : `/today?who=${v}`}
                className={`rounded-md border px-2 py-1 ${view === v ? "bg-muted font-medium" : ""}`}
              >
                {l}
              </Link>
            ))}
          </div>
        )}
      </div>

      {rem.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">Needs attention</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {rem.map((r, i) => (
              <li key={i} className="flex items-center gap-2">
                {r.urgent && <Badge variant="red">now</Badge>}
                <Link href={r.href} className="hover:underline">
                  {r.text}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Tasks</h2>
        {canEdit && <AddTask users={users} meId={user.id} jobs={jobs} />}
        {tasks.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing open. Jobs add tasks automatically as they move through the
            stages.
          </p>
        )}
        {GROUPS.map((g) => {
          const ts = (tasks as TaskRow[]).filter((t) => group(t, now) === g);
          if (!ts.length) return null;
          return (
            <div key={g}>
              <h3
                className={`text-sm font-medium ${g === "Overdue" ? "text-destructive" : "text-muted-foreground"}`}
              >
                {g} ({ts.length})
              </h3>
              <ul>
                {ts.map((t) => (
                  <li key={t.id} className="list-none">
                    <ul>
                      <TaskItem
                        t={t}
                        users={users}
                        canEdit={canEdit}
                        showJob
                        now={now}
                      />
                    </ul>
                    {view !== "me" && (
                      <p className="-mt-1 mb-1 pl-6 text-xs text-muted-foreground">
                        {t.assignee?.name ?? "Nobody assigned"}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>
    </div>
  );
}
