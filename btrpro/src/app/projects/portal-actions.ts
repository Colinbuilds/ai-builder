"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revokePortal, sharePortal } from "@/lib/portal/customer";
import {
  shareCrewLink,
  logCrewWork,
  uploadDeliveryTicket,
} from "@/lib/portal/crew";
import { linkCompanyCam } from "@/lib/integrations/companycam";

export type PResult = {
  problems: string[];
  ok?: boolean;
  note?: string;
  url?: string;
} | null;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function sharePortalAction(
  _: PResult,
  f: FormData,
): Promise<PResult> {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  const id = str(f, "projectId");
  try {
    const r = await sharePortal(id, u, { email: f.get("email") === "1" });
    revalidatePath(`/projects/${id}`);
    return {
      problems: [],
      ok: true,
      url: r.url,
      note: r.emailed
        ? `Emailed to ${r.emailed}.`
        : "Copy the link to the customer.",
    };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}

export async function revokePortalAction(f: FormData) {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  const id = str(f, "projectId");
  await revokePortal(id, u);
  revalidatePath(`/projects/${id}`);
}

export async function crewLinkAction(
  _: PResult,
  f: FormData,
): Promise<PResult> {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  const id = str(f, "crewId");
  try {
    const url = await shareCrewLink(id, u, f.get("rotate") === "1");
    revalidatePath(`/crews/${id}`);
    return {
      problems: [],
      ok: true,
      url,
      note:
        f.get("rotate") === "1"
          ? "New link made; the old one no longer works."
          : "Text this link to the crew lead.",
    };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}

export async function companyCamAction(
  _: PResult,
  f: FormData,
): Promise<PResult> {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  const id = str(f, "projectId");
  try {
    await linkCompanyCam(id, str(f, "link") || null, u);
  } catch (e) {
    return { problems: [msg(e)] };
  }
  revalidatePath(`/projects/${id}`);
  return { problems: [], ok: true };
}

/** Records that an EagleView report was ordered and adds a task to upload it when it arrives. */
export async function eagleViewOrderAction(
  _: PResult,
  f: FormData,
): Promise<PResult> {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  const id = str(f, "projectId");
  const report = str(f, "reportId") || null;
  const p = await prisma.project.update({
    where: { id },
    data: { eagleViewReportId: report, eagleViewOrderedAt: new Date() },
  });
  await prisma.projectActivity.create({
    data: {
      projectId: id,
      userId: u.id,
      kind: "details",
      text: `${u.name} ordered an EagleView report${report ? ` (#${report})` : ""}`,
    },
  });
  const has = await prisma.task.findFirst({
    where: { projectId: id, auto: "EV:upload", doneAt: null },
  });
  if (!has)
    await prisma.task.create({
      data: {
        projectId: id,
        title:
          "Upload the EagleView report when it arrives (Documents → Read measurements)",
        dueDate: new Date(Date.now() + 2 * 86_400_000),
        assigneeId: p.estimatorId ?? u.id,
        auto: "EV:upload",
        createdBy: u.name,
      },
    });
  revalidatePath(`/projects/${id}`);
  revalidatePath(`/projects/${id}/documents`);
  return {
    problems: [],
    ok: true,
    note: "Recorded. A task to upload it is on the job.",
  };
}

// ---------- crew link (no sign-in; the link is the key) ----------

export async function crewLogAction(_: PResult, f: FormData): Promise<PResult> {
  const token = str(f, "token");
  const date = str(f, "date");
  try {
    await logCrewWork(token, {
      projectId: str(f, "projectId"),
      date: new Date(`${date}T12:00:00Z`),
      amount: Number(str(f, "amount").replace(/[,\s]/g, "")),
      note: str(f, "note") || null,
    });
  } catch (e) {
    return { problems: [msg(e)] };
  }
  revalidatePath(`/c/${token}`);
  return { problems: [], ok: true, note: "Sent to the office for approval." };
}

export async function crewTicketAction(
  _: PResult,
  f: FormData,
): Promise<PResult> {
  const token = str(f, "token");
  const file = f.get("file");
  if (!(file instanceof File) || !file.size)
    return { problems: ["Take or choose a photo of the ticket."] };
  if (file.size > 20 * 1024 * 1024)
    return { problems: ["That photo is over 20 MB."] };
  try {
    await uploadDeliveryTicket(token, str(f, "projectId"), {
      bytes: new Uint8Array(await file.arrayBuffer()),
      name: file.name || "ticket.jpg",
      type: file.type || null,
    });
  } catch (e) {
    return { problems: [msg(e)] };
  }
  return { problems: [], ok: true, note: "Ticket uploaded. Thanks!" };
}
