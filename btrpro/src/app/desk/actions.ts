"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { BILLING_ROLES } from "@/lib/roles";

export type CallResult = { problems: string[]; ok?: boolean } | null;
const OUTCOMES = ["CALLED", "LEFT_VM", "EMAILED", "PROMISED", "DISPUTE"];

export async function logCallAction(_: CallResult, f: FormData): Promise<CallResult> {
  const u = await requireUser(BILLING_ROLES);
  const invoiceId = String(f.get("invoiceId"));
  const outcome = String(f.get("outcome"));
  const note = String(f.get("note") ?? "").trim();
  const follow = String(f.get("followUpOn") ?? "").trim();
  if (!OUTCOMES.includes(outcome)) return { problems: ["Pick what happened."] };
  if (!note && outcome !== "LEFT_VM") return { problems: ["Add a short note."] };
  if (outcome === "PROMISED" && !follow) return { problems: ["When did they promise to pay?"] };
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { projectId: true, number: true } });
  if (!inv) return { problems: ["Invoice not found."] };
  const followUpOn = follow ? new Date(`${follow}T12:00:00Z`) : null;
  await prisma.collectionNote.create({ data: { invoiceId, outcome, note: note || "Left voicemail", followUpOn, by: u.name } });
  await prisma.projectActivity.create({
    data: { projectId: inv.projectId, userId: u.id, kind: "billing", text: `${u.name} — collections on ${inv.number}: ${outcome.replace("_", " ").toLowerCase()}${note ? ` — ${note}` : ""}${followUpOn ? ` (follow up ${follow})` : ""}` },
  });
  revalidatePath("/desk/office");
  return { problems: [], ok: true };
}
