"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  addTimeEntry,
  approveTime,
  createWorkOrder,
  deleteTimeEntry,
  getWorkOrderByToken,
  ProductionError,
  saveCrew,
  scheduleEvent,
  sendWorkOrder,
  setWorkOrderStatus,
  updateEvent,
  updateWorkOrder,
  type ProdActor,
} from "@/lib/production/service";

export type PRes = { problems: string[]; ok?: boolean; note?: string; needsOverride?: boolean } | null;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => {
  const s = str(f, k).replace(/[$,%\s]/g, "");
  return s ? Number(s) : null;
};
const date = (f: FormData, k: string) => (str(f, k) ? new Date(`${str(f, k)}T12:00:00Z`) : null);
const lines = (f: FormData, k: string) => str(f, k).split("\n").map((l) => l.trim()).filter(Boolean);

async function actor(): Promise<ProdActor> {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  return { id: u.id, name: u.name, role: u.role };
}
async function run(fn: (a: ProdActor) => Promise<unknown>, paths: string[], note?: string): Promise<PRes> {
  const a = await actor();
  try {
    await fn(a);
  } catch (e) {
    return { problems: [msg(e)], needsOverride: e instanceof ProductionError && e.needsOverride };
  }
  for (const p of paths) revalidatePath(p, "layout");
  return { problems: [], ok: true, note };
}

export async function saveCrewAction(_: PRes, f: FormData): Promise<PRes> {
  const id = str(f, "id") || null;
  let savedId = id;
  const res = await run(
    async (a) => {
      const c = await saveCrew(
        id,
        {
          name: str(f, "name"),
          kind: str(f, "kind") === "SUB" ? "SUB" : "CREW",
          trade: str(f, "trade") || null,
          leadName: str(f, "leadName") || null,
          phone: str(f, "phone") || null,
          email: str(f, "email") || null,
          payType: (str(f, "payType") || null) as "HOURLY" | "PIECE" | null,
          defaultRate: num(f, "defaultRate"),
          rateUnit: str(f, "rateUnit").toUpperCase() || null,
          burdenPct: num(f, "burdenPct"),
          coiExpires: date(f, "coiExpires"),
          workersCompExpires: date(f, "workersCompExpires"),
          licenseNumber: str(f, "licenseNumber") || null,
          licenseExpires: date(f, "licenseExpires"),
          notes: str(f, "notes") || null,
          active: f.get("active") === "on",
        },
        a,
      );
      savedId = c.id;
    },
    ["/crews"],
  );
  if (res?.ok && !id) redirect(`/crews/${savedId}`);
  return res;
}

export async function scheduleEventAction(_: PRes, f: FormData): Promise<PRes> {
  const projectId = str(f, "projectId") || null;
  const start = date(f, "startDate");
  return run(
    (a) =>
      scheduleEvent(
        {
          projectId,
          kind: (str(f, "kind") || "INSTALL") as "INSTALL",
          title: str(f, "title"),
          startDate: start ?? new Date(NaN),
          endDate: date(f, "endDate") ?? start ?? new Date(NaN),
          crewId: str(f, "crewId") || null,
          status: str(f, "status") || "TENTATIVE",
          notes: str(f, "notes") || null,
          override: str(f, "override") || null,
        },
        a,
      ),
    ["/schedule", ...(projectId ? [`/projects/${projectId}`] : [])],
    "Scheduled.",
  );
}

export async function updateEventAction(_: PRes, f: FormData): Promise<PRes> {
  const patch: Parameters<typeof updateEvent>[1] = {};
  if (f.has("startDate")) patch.startDate = date(f, "startDate") ?? undefined;
  if (f.has("endDate")) patch.endDate = date(f, "endDate") ?? undefined;
  if (f.has("crewId")) patch.crewId = str(f, "crewId") || null;
  if (str(f, "status")) patch.status = str(f, "status");
  if (str(f, "weatherNote")) patch.weatherNote = str(f, "weatherNote");
  if (str(f, "override")) patch.override = str(f, "override");
  return run((a) => updateEvent(str(f, "id"), patch, a), ["/schedule", `/projects/${str(f, "projectId")}`]);
}

export async function createWorkOrderAction(_: PRes, f: FormData): Promise<PRes> {
  const projectId = str(f, "projectId");
  return run((a) => createWorkOrder(projectId, str(f, "crewId"), a), [`/projects/${projectId}`]);
}

export async function updateWorkOrderAction(_: PRes, f: FormData): Promise<PRes> {
  return run(
    (a) =>
      updateWorkOrder(
        str(f, "id"),
        {
          instructions: str(f, "instructions") || null,
          startDate: date(f, "startDate"),
          payBasis: str(f, "payBasis") || null,
          payQty: num(f, "payQty"),
          payUnit: str(f, "payUnit").toUpperCase() || null,
          payRate: num(f, "payRate"),
          amount: num(f, "amount"),
          scope: lines(f, "scope"),
          exclusions: lines(f, "exclusions"),
        },
        a,
      ),
    [`/projects/${str(f, "projectId")}`],
  );
}

export async function sendWorkOrderAction(_: PRes, f: FormData): Promise<PRes> {
  const a = await actor();
  try {
    const r = await sendWorkOrder(str(f, "id"), a);
    revalidatePath(`/projects/${str(f, "projectId")}`, "layout");
    return { problems: [], ok: true, note: r.emailed ? "Emailed to the crew." : `Sent. Text the crew this link: ${r.url}` };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}

export async function workOrderStatusAction(_: PRes, f: FormData): Promise<PRes> {
  return run((a) => setWorkOrderStatus(str(f, "id"), str(f, "status") as "COMPLETE", a, str(f, "reason") || undefined), [`/projects/${str(f, "projectId")}`]);
}

/** From the crew's work-order link (no login): mark started / done. */
export async function crewWorkOrderAction(_: PRes, f: FormData): Promise<PRes> {
  const token = str(f, "token");
  const w = await getWorkOrderByToken(token);
  if (!w) return { problems: ["This work order isn't available."] };
  const name = str(f, "name");
  if (!name) return { problems: ["Enter your name."] };
  try {
    await setWorkOrderStatus(w.id, str(f, "status") === "COMPLETE" ? "COMPLETE" : "IN_PROGRESS", { id: null, name: `${name} (${w.crew.name})` });
  } catch (e) {
    return { problems: [msg(e)] };
  }
  revalidatePath(`/w/${token}`);
  return { problems: [], ok: true };
}

export async function addTimeAction(_: PRes, f: FormData): Promise<PRes> {
  const projectId = str(f, "projectId");
  return run(
    (a) =>
      addTimeEntry(
        projectId,
        { crewId: str(f, "crewId"), date: date(f, "date") ?? new Date(NaN), basis: str(f, "basis") === "PIECE" ? "PIECE" : "HOURLY", hours: num(f, "hours"), qty: num(f, "qty"), unit: str(f, "unit") || null, rate: num(f, "rate"), burdenPct: num(f, "burdenPct"), note: str(f, "note") || null },
        a,
      ),
    [`/projects/${projectId}`],
    "Logged.",
  );
}

export async function approveTimeAction(_: PRes, f: FormData): Promise<PRes> {
  return run((a) => approveTime(str(f, "id"), a), [`/projects/${str(f, "projectId")}`]);
}

export async function deleteTimeAction(_: PRes, f: FormData): Promise<PRes> {
  return run((a) => deleteTimeEntry(str(f, "id"), a), [`/projects/${str(f, "projectId")}`]);
}
