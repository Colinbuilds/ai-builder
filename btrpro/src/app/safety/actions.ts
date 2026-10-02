"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { addCompanyFile, addIncident, addToolboxTalk, saveSafetyYear } from "@/lib/safety/service";

export type SafetyResult = { problems: string[]; ok?: boolean } | null;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => (str(f, k) === "" ? null : Number(str(f, k).replace(/[,\s]/g, "")));
const day = (f: FormData, k: string) => (str(f, k) ? new Date(`${str(f, k)}T12:00:00Z`) : new Date(NaN));
const wrap = async (fn: () => Promise<unknown>): Promise<SafetyResult> => {
  try {
    await fn();
    revalidatePath("/safety");
    return { problems: [], ok: true };
  } catch (e) {
    return { problems: [e instanceof Error ? e.message : String(e)] };
  }
};

export async function talkAction(_: SafetyResult, f: FormData) {
  const u = await requireUser(STAFF_ROLES);
  return wrap(() => addToolboxTalk({ date: day(f, "date"), topic: str(f, "topic"), presenter: str(f, "presenter"), crewId: str(f, "crewId") || null, projectId: str(f, "projectId") || null, attendees: str(f, "attendees"), notes: str(f, "notes") || null }, u));
}

export async function incidentAction(_: SafetyResult, f: FormData) {
  const u = await requireUser(STAFF_ROLES);
  return wrap(() =>
    addIncident(
      { date: day(f, "date"), kind: str(f, "kind"), personName: str(f, "personName") || null, crewId: str(f, "crewId") || null, projectId: str(f, "projectId") || null, description: str(f, "description"), daysAway: num(f, "daysAway"), daysRestricted: num(f, "daysRestricted"), correctiveAction: str(f, "correctiveAction") || null },
      u,
    ),
  );
}

export async function yearAction(_: SafetyResult, f: FormData) {
  const u = await requireUser(["ADMIN", "OFFICE"]);
  return wrap(() => saveSafetyYear(Number(str(f, "year")), { hoursWorked: num(f, "hoursWorked"), avgEmployees: num(f, "avgEmployees"), emr: num(f, "emr") }, u));
}

export async function fileAction(_: SafetyResult, f: FormData) {
  const u = await requireUser(["ADMIN", "OFFICE"]);
  const file = f.get("file");
  return wrap(async () => {
    if (!(file instanceof File) || !file.size) throw new Error("Choose the file.");
    await addCompanyFile({ kind: str(f, "kind"), title: str(f, "title"), bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name, contentType: file.type || null, expiresAt: str(f, "expiresAt") ? day(f, "expiresAt") : null }, u);
  });
}

export async function deleteFileAction(f: FormData) {
  await requireUser(["ADMIN", "OFFICE"]);
  await prisma.companyFile.delete({ where: { id: str(f, "id") } });
  revalidatePath("/safety");
}
