"use server";

import { STAFF_ROLES } from "@/lib/roles";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  addTask,
  deleteTask,
  setTaskDone,
  updateTask,
} from "@/lib/tasks/service";

export type TResult = { problems: string[]; ok?: boolean } | null;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const day = (v: string) => (v ? new Date(`${v}T12:00:00Z`) : null);
const refresh = (projectId: string | null) => {
  revalidatePath("/today");
  if (projectId) revalidatePath(`/projects/${projectId}`);
};

export async function addTaskAction(_: TResult, f: FormData): Promise<TResult> {
  const u = await requireUser(STAFF_ROLES);
  const projectId = str(f, "projectId") || null;
  const who = str(f, "assigneeId");
  try {
    await addTask(
      {
        projectId,
        title: str(f, "title"),
        dueDate: day(str(f, "dueDate")),
        assigneeId: who === "none" ? null : who || u.id,
        notes: str(f, "notes") || null,
      },
      u,
    );
  } catch (e) {
    return { problems: [msg(e)] };
  }
  refresh(projectId);
  return { problems: [], ok: true };
}

export async function toggleTaskAction(f: FormData) {
  const u = await requireUser(STAFF_ROLES);
  const t = await setTaskDone(str(f, "id"), f.get("done") === "1", u);
  refresh(t.projectId);
}

export async function reassignTaskAction(f: FormData) {
  const u = await requireUser(STAFF_ROLES);
  const who = str(f, "assigneeId");
  const t = await updateTask(
    str(f, "id"),
    {
      assigneeId: who || null,
      ...(f.has("dueDate") ? { dueDate: day(str(f, "dueDate")) } : {}),
    },
    u,
  );
  refresh(t.projectId);
}

export async function deleteTaskAction(f: FormData) {
  const u = await requireUser(STAFF_ROLES);
  await deleteTask(str(f, "id"), u);
  refresh(str(f, "projectId") || null);
}
