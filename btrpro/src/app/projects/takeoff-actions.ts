"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveTakeoff, sendToJob, TakeoffError } from "@/lib/takeoff/service";
import { aiDraftTakeoff, AiMeasureError, type AiRegion } from "@/lib/takeoff/ai";
import { aiConfigured, aiErrorMessage } from "@/lib/ai/claude";
import type { TakeoffItem, View } from "@/lib/takeoff/geometry";

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

export type AiMeasureResult =
  | { ok: true; items: TakeoffItem[]; sheet: string; detectedView: View | null; sheetType: string; printedScale: string | null; cannotTrace: string[]; dropped: number }
  | { ok: false; message: string };

/** AI draft of what's on screen. The image comes from the browser's own render of the sheet. */
export async function aiMeasureAction(
  documentId: string,
  input: { imageBase64: string; mediaType: "image/jpeg" | "image/png"; region: AiRegion; view: View },
): Promise<AiMeasureResult> {
  await requireUser([...EDIT]);
  if (!aiConfigured()) return { ok: false, message: "BTRbot isn't set up (ANTHROPIC_API_KEY on the server). Trace by hand for now." };
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { id: true } });
  if (!doc) return { ok: false, message: "That plan file is gone." };
  try {
    const r = await aiDraftTakeoff(input);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, message: e instanceof AiMeasureError ? e.message : aiErrorMessage(e) };
  }
}
