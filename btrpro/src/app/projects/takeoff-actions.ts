"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveTakeoff, sendToJob, TakeoffError } from "@/lib/takeoff/service";
import { aiDraftTakeoff, AiMeasureError, aiReadSheet, type AiRegion } from "@/lib/takeoff/ai";
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
  | {
      ok: true;
      items: TakeoffItem[];
      sheet: string;
      detectedView: View | null;
      sheetType: string;
      printedScale: string | null;
      scaleBar: { a: [number, number]; b: [number, number]; feet: number } | null;
      counted: { windows: number; doors: number; patio_sliders: number; garage_doors: number };
      cannotTrace: string[];
      dropped: number;
    }
  | { ok: false; message: string };

/** AI draft of what's on screen. The image comes from the browser's own render of the sheet. */
export async function aiMeasureAction(
  documentId: string,
  input: { imageBase64: string; mediaType: "image/jpeg" | "image/png"; region: AiRegion; view: View; notes?: string },
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

export type AiSheetResult = { ok: true; views: Awaited<ReturnType<typeof aiReadSheet>>["views"]; notes: string[]; printedScale: string | null } | { ok: false; message: string };

/** First pass of "measure the whole sheet": find each view and read the notes. */
export async function aiReadSheetAction(documentId: string, input: { imageBase64: string; mediaType: "image/jpeg" | "image/png" }): Promise<AiSheetResult> {
  await requireUser([...EDIT]);
  if (!aiConfigured()) return { ok: false, message: "BTRbot isn't set up (ANTHROPIC_API_KEY on the server). Trace by hand for now." };
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { id: true } });
  if (!doc) return { ok: false, message: "That plan file is gone." };
  try {
    return { ok: true, ...(await aiReadSheet(input)) };
  } catch (e) {
    return { ok: false, message: e instanceof AiMeasureError ? e.message : aiErrorMessage(e) };
  }
}

/** Upload a plan sheet or a photo straight from the measure page; returns the new sheet to open. */
export async function uploadSheetAction(f: FormData): Promise<TakeoffResult & { docId?: string }> {
  const { STAFF_ROLES } = await import("@/lib/roles");
  const u = await requireUser([...STAFF_ROLES]);
  const projectId = String(f.get("projectId") ?? "");
  const file = f.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, message: "Choose a plan PDF or a photo." };
  const { addDocument } = await import("@/lib/docs/documents");
  const { sheetKind } = await import("@/lib/takeoff/sheets");
  try {
    if (!(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }))) return { ok: false, message: "That job wasn't found." };
    const { doc } = await addDocument({ projectId, bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name || "photo.jpg", contentType: file.type || null, userId: u.id });
    revalidatePath(`/projects/${projectId}`, "layout");
    if (!sheetKind(doc.fileName, doc.contentType))
      return { ok: false, message: `${doc.fileName} was saved to the job's documents, but it can't be measured. Use a PDF, JPG or PNG — on an iPhone, Settings → Camera → Formats → Most Compatible.` };
    return { ok: true, docId: doc.id };
  } catch (e) {
    console.error("sheet upload failed", e);
    return { ok: false, message: `Upload failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
