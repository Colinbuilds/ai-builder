"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { ProdError } from "@/lib/production/board";
import { createHouse, saveScopeDetails, setScopeStatus } from "@/lib/production/homes";
import { readPacket, WorkOrderError, type Packet } from "@/lib/production/work-order";

export type HouseResult = { problems: string[] } | null;
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

const workOrdersOf = (json: string) => {
  try {
    const v = json ? JSON.parse(json) : [];
    return Array.isArray(v) ? (v as { scope: string; workOrder: string | null; sell: number | null; notes: string; fileUrl: string }[]) : [];
  } catch {
    return [];
  }
};

/** Drop zone on Create job: read the work orders and plan set into the form. */
export async function readPacketAction(f: FormData): Promise<{ packet?: Packet; error?: string }> {
  await requireUser(STAFF_ROLES);
  const files = await Promise.all(f.getAll("file").filter((x): x is File => x instanceof File && x.size > 0).map(async (x) => ({ name: x.name, bytes: new Uint8Array(await x.arrayBuffer()) })));
  try {
    return { packet: await readPacket(files) };
  } catch (e) {
    if (e instanceof WorkOrderError) return { error: e.message };
    throw e;
  }
}

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
        basement: s(f, "basement") || null,
        addOns: f.getAll("addOn").map(String),
        elevationType: s(f, "elevationType") || null,
        houseInfo: s(f, "houseInfo") || null,
        planUrl: s(f, "planUrl") || null,
        workOrders: workOrdersOf(s(f, "workOrders")),
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
