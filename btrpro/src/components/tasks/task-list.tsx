import Link from "next/link";
import {
  deleteTaskAction,
  reassignTaskAction,
  toggleTaskAction,
} from "@/app/task-actions";
import { AddTask } from "./add-task";

export type TaskRow = {
  id: string;
  title: string;
  notes: string | null;
  dueDate: Date | null;
  doneAt: Date | null;
  doneBy: string | null;
  auto: string | null;
  assigneeId: string | null;
  assignee: { name: string } | null;
  project: { id: string; name: string } | null;
  projectId: string | null;
};
const d = (x: Date) =>
  x.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });

/** One task: check it off, see job and due date, reassign. Server-rendered; the forms post straight to actions. */
export function TaskItem({
  t,
  users,
  canEdit,
  showJob,
  now,
}: {
  t: TaskRow;
  users: { id: string; name: string }[];
  canEdit: boolean;
  showJob: boolean;
  now: Date;
}) {
  const late =
    !t.doneAt &&
    t.dueDate &&
    t.dueDate.getTime() < now.getTime() - 86_400_000 / 2;
  return (
    <li
      className={`flex flex-wrap items-start gap-2 border-b py-2 text-sm last:border-0 ${t.doneAt ? "opacity-60" : ""}`}
    >
      {canEdit && (
        <form action={toggleTaskAction}>
          <input type="hidden" name="id" value={t.id} />
          <input type="hidden" name="done" value={t.doneAt ? "0" : "1"} />
          <button
            aria-label={t.doneAt ? "Mark not done" : "Mark done"}
            className={`mt-0.5 h-4 w-4 rounded border ${t.doneAt ? "bg-primary" : "hover:bg-muted"}`}
          />
        </form>
      )}
      <div className="min-w-0 flex-1">
        <span className={t.doneAt ? "line-through" : ""}>{t.title}</span>
        {showJob && t.project && (
          <Link
            href={`/projects/${t.project.id}`}
            className="ml-2 text-xs text-muted-foreground hover:underline"
          >
            {t.project.name}
          </Link>
        )}
        {t.notes && (
          <span className="block text-xs text-muted-foreground">{t.notes}</span>
        )}
        <span className="block text-xs text-muted-foreground">
          {t.doneAt ? (
            `Done ${d(t.doneAt)}${t.doneBy ? ` by ${t.doneBy}` : ""}`
          ) : t.dueDate ? (
            <span className={late ? "font-medium text-destructive" : ""}>
              Due {d(t.dueDate)}
            </span>
          ) : (
            "No due date"
          )}
          {t.auto && " · automatic"}
        </span>
      </div>
      {canEdit && !t.doneAt && (
        <form action={reassignTaskAction} className="flex items-center gap-1">
          <input type="hidden" name="id" value={t.id} />
          <select
            name="assigneeId"
            defaultValue={t.assigneeId ?? ""}
            className="h-7 rounded-md border bg-background px-1 text-xs"
          >
            <option value="">Nobody</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <button className="text-xs underline">Save</button>
        </form>
      )}
      {canEdit && (
        <form action={deleteTaskAction}>
          <input type="hidden" name="id" value={t.id} />
          <input type="hidden" name="projectId" value={t.projectId ?? ""} />
          <button
            className="text-xs text-muted-foreground underline"
            aria-label="Delete task"
          >
            ×
          </button>
        </form>
      )}
    </li>
  );
}

export function JobTasks({
  projectId,
  tasks,
  users,
  canEdit,
  meId,
}: {
  projectId: string;
  tasks: TaskRow[];
  users: { id: string; name: string }[];
  canEdit: boolean;
  meId: string;
}) {
  const open = tasks.filter((t) => !t.doneAt);
  const done = tasks.filter((t) => t.doneAt);
  const now = new Date();
  return (
    <section id="tasks" className="flex flex-col gap-2 rounded-md border p-4">
      <h2 className="font-semibold">Tasks ({open.length} open)</h2>
      {open.length > 0 ? (
        <ul>
          {open.map((t) => (
            <TaskItem
              key={t.id}
              t={t}
              users={users}
              canEdit={canEdit}
              showJob={false}
              now={now}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nothing open. Tasks are added automatically when the job moves stage.
        </p>
      )}
      {canEdit && <AddTask projectId={projectId} users={users} meId={meId} />}
      {done.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            {done.length} done
          </summary>
          <ul>
            {done.map((t) => (
              <TaskItem
                key={t.id}
                t={t}
                users={users}
                canEdit={canEdit}
                showJob={false}
                now={now}
              />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
