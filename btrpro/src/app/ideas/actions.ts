"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { addIdea, IdeaError, setIdeaStatus, toggleVote } from "@/lib/ideas/service";

export type IResult = { problems: string[]; ok?: boolean } | null;

export async function addIdeaAction(_: IResult, f: FormData): Promise<IResult> {
  const u = await requireUser(STAFF_ROLES);
  const minutes = Number(f.get("minutes"));
  try {
    await addIdea({ title: String(f.get("title") ?? ""), details: String(f.get("details") ?? ""), often: String(f.get("often") ?? "WEEKLY"), minutes: minutes > 0 ? Math.round(minutes) : null, area: String(f.get("area") ?? "") || null }, u);
  } catch (e) {
    if (e instanceof IdeaError) return { problems: [e.message] };
    throw e;
  }
  revalidatePath("/ideas");
  return { problems: [], ok: true };
}

export async function voteAction(f: FormData) {
  const u = await requireUser(STAFF_ROLES);
  await toggleVote(String(f.get("id")), u);
  revalidatePath("/ideas");
}

export async function statusAction(f: FormData) {
  const u = await requireUser(["ADMIN"]);
  void u;
  await setIdeaStatus(String(f.get("id")), String(f.get("status")), String(f.get("reply") ?? ""));
  revalidatePath("/ideas");
}
