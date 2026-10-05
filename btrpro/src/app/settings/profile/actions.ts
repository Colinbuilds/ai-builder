"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { ProfileError, saveCompanyProfile } from "@/lib/company-profile";
import { btrCompanyRules } from "@/lib/ai/prompt";

export type ProfileResult = { problems: string[]; ok?: boolean } | null;

export async function saveProfileAction(_: ProfileResult, f: FormData): Promise<ProfileResult> {
  const u = await requireUser(["ADMIN"]);
  const input: Record<string, string> = {};
  for (const [k, v] of f.entries()) if (typeof v === "string") input[k] = v.replace(/\r\n/g, "\n");
  // BTR's built-in rules are shown in the editor to start from; saving them unchanged keeps CLAUDE.md as the prompt
  if (input.aiRules?.trim() === btrCompanyRules()) input.aiRules = "";
  const file = f.get("logo");
  const logo = file instanceof File && file.size ? { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name } : null;
  try {
    await saveCompanyProfile(input, logo, { removeLogo: f.get("removeLogo") === "on" }, u);
  } catch (e) {
    if (e instanceof ProfileError) return { problems: [e.message] };
    throw e;
  }
  // names, colors and the logo show on every page
  revalidatePath("/", "layout");
  return { problems: [], ok: true };
}
