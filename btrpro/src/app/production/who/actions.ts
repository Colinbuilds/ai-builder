"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { saveCrewScopes, savePm } from "@/lib/production/assign";

const lines = (v: FormDataEntryValue | null) => String(v ?? "").split(/\n|;/);

export async function savePmAction(f: FormData) {
  await requireUser(STAFF_ROLES);
  await savePm(String(f.get("userId")), {
    scheduleName: String(f.get("scheduleName") ?? ""),
    builders: [...f.getAll("builder").map(String), ...lines(f.get("moreBuilders"))],
    crews: f.getAll("crew").map(String),
  });
  revalidatePath("/production/who");
  revalidatePath("/");
}

export async function saveCrewScopesAction(f: FormData) {
  await requireUser(STAFF_ROLES);
  await saveCrewScopes(String(f.get("crewId")), [...f.getAll("scope").map(String), ...String(f.get("other") ?? "").split(",")]);
  revalidatePath("/production/who");
}
