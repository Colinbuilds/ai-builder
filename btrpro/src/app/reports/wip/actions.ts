"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { BILLING_ROLES } from "@/lib/roles";
import { saveSnapshot, setEtc } from "@/lib/reports/wip";

export async function etcAction(f: FormData) {
  const u = await requireUser(BILLING_ROLES);
  const raw = String(f.get("etc") ?? "").replace(/[$,\s]/g, "");
  await setEtc(String(f.get("id")), raw === "" ? null : Number(raw), u);
  revalidatePath("/reports/wip");
}

export async function snapshotAction() {
  const u = await requireUser(["ADMIN", "OFFICE"]);
  await saveSnapshot(u);
  revalidatePath("/reports/wip");
}
