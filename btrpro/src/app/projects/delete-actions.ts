"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { deleteProject, deleteProjects } from "@/lib/projects/delete";

export type DResult = {
  problems: string[];
  ok?: boolean;
  note?: string;
} | null;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function deleteProjectAction(
  _: DResult,
  f: FormData,
): Promise<DResult> {
  const admin = await requireUser(["ADMIN"]);
  try {
    await deleteProject(
      String(f.get("id")),
      String(f.get("confirm") ?? ""),
      admin,
    );
  } catch (e) {
    return { problems: [msg(e)] };
  }
  revalidatePath("/");
  redirect("/?deleted=1");
}

export async function deleteProjectsAction(
  _: DResult,
  f: FormData,
): Promise<DResult> {
  const admin = await requireUser(["ADMIN"]);
  const ids = f.getAll("ids").map(String);
  if (!ids.length) return { problems: ["Tick the jobs to delete."] };
  if (
    String(f.get("confirm") ?? "")
      .trim()
      .toLowerCase() !== "delete"
  )
    return {
      problems: [
        `Type DELETE to confirm deleting ${ids.length} job${ids.length === 1 ? "" : "s"}.`,
      ],
    };
  const r = await deleteProjects(ids, admin);
  revalidatePath("/");
  return {
    problems: r.skipped,
    ok: r.deleted.length > 0,
    note: `Deleted ${r.deleted.length} job${r.deleted.length === 1 ? "" : "s"}.${r.skipped.length ? ` ${r.skipped.length} kept:` : ""}`,
  };
}
