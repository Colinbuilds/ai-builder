"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveTakeoff, sendToJob, TakeoffError } from "@/lib/takeoff/service";

export type TakeoffResult = { ok: boolean; message?: string };
const EDIT = ["ADMIN", "ESTIMATOR"] as const;

export async function saveTakeoffAction(documentId: string, page: number, data: unknown): Promise<TakeoffResult> {
  const u = await requireUser([...EDIT]);
  try {
    await saveTakeoff(documentId, page, data, u);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof TakeoffError ? e.message : "Couldn't save. Check your connection and try again." };
  }
}

export async function sendTakeoffAction(documentId: string, page: number): Promise<TakeoffResult> {
  const u = await requireUser([...EDIT]);
  try {
    const r = await sendToJob(documentId, page, u);
    const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { projectId: true } });
    if (doc) revalidatePath(`/projects/${doc.projectId}`, "layout");
    return { ok: true, message: `Sent ${r.count} measurement${r.count === 1 ? "" : "s"} to the job.` };
  } catch (e) {
    return { ok: false, message: e instanceof TakeoffError ? e.message : "Couldn't send. Try again." };
  }
}
