"use server";

import { LeadError, submitLead } from "@/lib/leads";

export type FormState = { ok?: boolean; error?: string } | null;

export async function requestDemo(_: FormState, f: FormData): Promise<FormState> {
  try {
    await submitLead(Object.fromEntries(f.entries()));
    return { ok: true };
  } catch (e) {
    if (e instanceof LeadError) return { error: e.message };
    throw e;
  }
}
