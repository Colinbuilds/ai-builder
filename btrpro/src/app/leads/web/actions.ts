"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { saveSettings } from "@/lib/settings";
import { LeadFormError, assignWebLead, closeWebLead, scheduleInspection } from "@/lib/leads/web";

const done = (err?: string) => {
  revalidatePath("/leads/web");
  if (err) redirect(`/leads/web?err=${encodeURIComponent(err)}`);
};
const msg = (e: unknown) => (e instanceof LeadFormError ? e.message : e instanceof Error ? e.message : String(e));

export async function assignAction(f: FormData) {
  const u = await requireUser(STAFF_ROLES);
  let err: string | undefined;
  try {
    await assignWebLead(String(f.get("id")), String(f.get("salespersonId") ?? ""), u);
  } catch (e) {
    err = msg(e);
  }
  done(err);
}

export async function inspectionAction(f: FormData) {
  const u = await requireUser(STAFF_ROLES);
  let err: string | undefined;
  try {
    await scheduleInspection(String(f.get("id")), { date: String(f.get("date") ?? ""), time: String(f.get("time") ?? "") }, u);
  } catch (e) {
    err = msg(e);
  }
  done(err);
}

export async function closeAction(f: FormData) {
  const u = await requireUser(STAFF_ROLES);
  await closeWebLead(String(f.get("id")), u);
  done();
}

export async function managerAction(f: FormData) {
  const u = await requireUser(["ADMIN"]);
  await saveSettings({ salesManagerId: String(f.get("salesManagerId") ?? "") || null }, u);
  done();
}
