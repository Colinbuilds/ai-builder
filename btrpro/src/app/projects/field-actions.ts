"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { EDIT_ROLES } from "@/lib/roles";
import { addPunch, completeJob, FieldError, resolveIssue, setPunchDone, setReadyCheck } from "@/lib/production/field";
import { ProjectError } from "@/lib/projects/service";

export type FResult = { problems: string[]; ok?: boolean } | null;
const again = (id: string) => revalidatePath(`/projects/${id}`, "layout");

export async function readyCheckAction(f: FormData) {
  const u = await requireUser(EDIT_ROLES);
  const id = String(f.get("projectId"));
  await setReadyCheck(id, String(f.get("key")), f.get("on") === "1", u);
  again(id);
}

export async function addPunchAction(f: FormData) {
  const u = await requireUser(EDIT_ROLES);
  const id = String(f.get("projectId"));
  const text = String(f.get("text") ?? "");
  if (text.trim()) await addPunch(id, text, String(f.get("crewId") ?? "") || null, u);
  again(id);
}

export async function punchDoneAction(f: FormData) {
  const u = await requireUser(EDIT_ROLES);
  const item = await setPunchDone(String(f.get("id")), f.get("done") === "1", u);
  again(item.projectId);
}

export async function resolveIssueAction(f: FormData) {
  const u = await requireUser(EDIT_ROLES);
  const i = await resolveIssue(String(f.get("id")), f.get("status") === "NO_CHARGE" ? "NO_CHARGE" : "PRICED", String(f.get("resolution") ?? "") || null, u);
  again(i.projectId);
}

export async function completeJobAction(_: FResult, f: FormData): Promise<FResult> {
  const u = await requireUser(EDIT_ROLES);
  const id = String(f.get("projectId"));
  try {
    await completeJob(id, String(f.get("note") ?? "") || null, u);
  } catch (e) {
    if (e instanceof FieldError) return { problems: [e.message] };
    if (e instanceof ProjectError) return { problems: e.problems };
    throw e;
  }
  again(id);
  return { problems: [], ok: true };
}

