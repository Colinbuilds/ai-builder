"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { addStarters, markReviewed, saveSop } from "@/lib/playbook/service";

export type PlaybookResult = { problems: string[] } | null;

export async function saveSopAction(_: PlaybookResult, f: FormData): Promise<PlaybookResult> {
  const u = await requireUser(STAFF_ROLES);
  const id = String(f.get("id") ?? "") || null;
  let saved;
  try {
    saved = await saveSop(id, { title: String(f.get("title") ?? ""), area: String(f.get("area") ?? ""), ownerName: String(f.get("ownerName") ?? "") || null, body: String(f.get("body") ?? ""), reviewEveryMonths: Number(f.get("reviewEveryMonths") ?? 12), draft: f.get("draft") === "1" }, u);
  } catch (e) {
    return { problems: [e instanceof Error ? e.message : String(e)] };
  }
  revalidatePath("/playbook");
  redirect(`/playbook/${saved.id}`);
}

export async function reviewedAction(f: FormData) {
  const u = await requireUser(STAFF_ROLES);
  const id = String(f.get("id"));
  await markReviewed(id, u);
  revalidatePath("/playbook");
  revalidatePath(`/playbook/${id}`);
}

export async function startersAction() {
  const u = await requireUser(["ADMIN", "OFFICE"]);
  await addStarters(u);
  revalidatePath("/playbook");
}

export async function deleteSopAction(f: FormData) {
  await requireUser(["ADMIN"]);
  await prisma.sop.delete({ where: { id: String(f.get("id")) } });
  revalidatePath("/playbook");
  redirect("/playbook");
}
