"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { ProdError } from "@/lib/production/board";
import { createHouse, saveScopeDetails, setScopeStatus } from "@/lib/production/homes";

export type HouseResult = { problems: string[] } | null;
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function createHouseAction(_: HouseResult, f: FormData): Promise<HouseResult> {
  const u = await requireUser(STAFF_ROLES);
  const start = s(f, "startDate").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  try {
    await createHouse(
      {
        builder: s(f, "builder"),
        address: s(f, "address"),
        model: s(f, "model"),
        elevation: s(f, "elevation"),
        scopes: f.getAll("scope").map(String),
        superName: s(f, "superName") || null,
        vpo: s(f, "vpo") || null,
        startDate: start ? new Date(Date.UTC(+start[1], +start[2] - 1, +start[3], 12)) : null,
        notes: s(f, "notes") || null,
      },
      u,
    );
  } catch (e) {
    if (e instanceof ProdError) return { problems: [e.message] };
    throw e;
  }
  revalidatePath("/production", "layout");
  redirect(`/production/homes?b=${encodeURIComponent(s(f, "builder"))}&added=1`);
}

export async function scopeStatusAction(id: string, status: string): Promise<{ error?: string }> {
  const u = await requireUser(STAFF_ROLES);
  try {
    await setScopeStatus(id, status, u);
  } catch (e) {
    if (e instanceof ProdError) return { error: e.message };
    throw e;
  }
  revalidatePath("/production", "layout");
  return {};
}

/** "+ Add" in an empty scope cell: the same house (address, model, elevation) gets that scope. */
export async function addScopeAction(f: FormData) {
  const u = await requireUser(STAFF_ROLES);
  await createHouse({ builder: s(f, "builder"), address: s(f, "address"), model: s(f, "model"), elevation: s(f, "elevation"), scopes: [s(f, "scope")], superName: s(f, "superName") || null }, u);
  revalidatePath("/production", "layout");
}

export async function scopeDetailsAction(id: string, input: { materials: { name: string; qty: string; unit: string }[]; sell: string; payout: string }): Promise<{ error?: string }> {
  const u = await requireUser(STAFF_ROLES);
  try {
    await saveScopeDetails(id, input, u);
  } catch (e) {
    if (e instanceof ProdError) return { error: e.message };
    throw e;
  }
  revalidatePath("/production", "layout");
  return {};
}
