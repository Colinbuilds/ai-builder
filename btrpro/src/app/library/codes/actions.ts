"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { STAFF_ROLES } from "@/lib/roles";
import { aiConfigured, aiErrorMessage } from "@/lib/ai/claude";
import { askCodeQuestion } from "@/lib/codes/library";
import { botName, companySync } from "@/lib/company-profile";

export type AskResult = { ok: boolean; message?: string; id?: string } | null;

export async function askAction(_: AskResult, f: FormData): Promise<AskResult> {
  const u = await requireUser(STAFF_ROLES);
  if (!aiConfigured()) return { ok: false, message: `${botName()} isn't set up (ANTHROPIC_API_KEY on the server).` };
  try {
    const r = await askCodeQuestion(
      {
        question: String(f.get("question") ?? ""),
        jurisdiction: String(f.get("jurisdiction") ?? "").trim() || companySync().jurisdiction,
        projectId: String(f.get("projectId") ?? "") || null,
        officialOnly: f.get("official") === "on",
        useJobSpecs: f.get("specs") === "on",
      },
      u,
    );
    revalidatePath("/library/codes");
    return { ok: true, id: r.id };
  } catch (e) {
    return { ok: false, message: e instanceof Error && !("status" in e) ? e.message : aiErrorMessage(e) };
  }
}

export async function addLinkAction(f: FormData) {
  const u = await requireUser(STAFF_ROLES);
  const url = String(f.get("url") ?? "").trim();
  const title = String(f.get("title") ?? "").trim();
  if (!/^https?:\/\//i.test(url) || !title) return;
  await prisma.libraryLink.create({ data: { kind: String(f.get("kind") ?? "MANUFACTURER"), title, url, jurisdiction: String(f.get("jurisdiction") ?? "").trim() || null, note: String(f.get("note") ?? "").trim() || null, createdBy: u.name } });
  revalidatePath("/library/codes");
}

export async function removeLinkAction(f: FormData) {
  await requireUser(STAFF_ROLES);
  await prisma.libraryLink.delete({ where: { id: String(f.get("id")) } });
  revalidatePath("/library/codes");
}
