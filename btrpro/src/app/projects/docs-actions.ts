"use server";

import { STAFF_ROLES } from "@/lib/roles";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { addDocument } from "@/lib/docs/documents";
import { extractEagleView, extractPlansSpecs } from "@/lib/docs/extraction";
import { runPlanReview } from "@/lib/docs/plan-review";
import {
  addManualMeasurement,
  confirmMeasurement,
  decideFact,
  rejectMeasurement,
} from "@/lib/docs/confirm";
import { importFromDrive } from "@/lib/integrations/drive";
import { aiErrorMessage } from "@/lib/ai/claude";
import { convertOldProposal, LegacyProposalError } from "@/lib/proposals/legacy";
import { ContractReviewError, reviewContract } from "@/lib/docs/contract-review";
import { redirect } from "next/navigation";
import { appName } from "@/lib/company-profile";

export type DocsResult = {
  problems: string[];
  ok?: boolean;
  note?: string;
} | null;
const EDITORS = STAFF_ROLES;
const DOC_TYPES = [
  "EAGLEVIEW",
  "PLANS",
  "SPECS",
  "MFR_DATA",
  "SUB_PROPOSAL",
  "CHANGE_ORDER",
  "PHOTO",
  "OTHER",
];
const path = (id: string) => `/projects/${id}/documents`;

export async function uploadDocumentsAction(
  _: DocsResult,
  f: FormData,
): Promise<DocsResult> {
  const user = await requireUser([...EDITORS]);
  const projectId = String(f.get("projectId"));
  const files = f
    .getAll("files")
    .filter((x): x is File => x instanceof File && x.size > 0);
  if (!files.length) return { problems: ["Choose one or more files."] };
  const problems: string[] = [];
  let added = 0;
  for (const file of files) {
    try {
      await addDocument({
        projectId,
        bytes: new Uint8Array(await file.arrayBuffer()),
        fileName: file.name,
        contentType: file.type || null,
        userId: user.id,
      });
      added++;
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
    }
  }
  revalidatePath(path(projectId));
  return {
    problems,
    ok: added > 0,
    note: `${added} file${added === 1 ? "" : "s"} added.`,
  };
}

export async function importDriveAction(
  _: DocsResult,
  f: FormData,
): Promise<DocsResult> {
  const user = await requireUser([...EDITORS]);
  const projectId = String(f.get("projectId"));
  try {
    const r = await importFromDrive(
      projectId,
      String(f.get("link") ?? ""),
      user,
    );
    revalidatePath(path(projectId));
    return {
      problems: r.errors,
      ok: true,
      note: `${r.added} added from Drive${r.skipped ? `, ${r.skipped} already on the job` : ""}.`,
    };
  } catch (e) {
    return { problems: [e instanceof Error ? e.message : String(e)] };
  }
}

export async function setDocTypeAction(f: FormData) {
  await requireUser([...EDITORS]);
  const id = String(f.get("id"));
  const type = String(f.get("type"));
  if (!DOC_TYPES.includes(type)) return;
  const d = await prisma.document.update({
    where: { id },
    data: { type: type as never },
  });
  revalidatePath(path(d.projectId));
}

export async function extractAction(
  _: DocsResult,
  f: FormData,
): Promise<DocsResult> {
  await requireUser([...EDITORS]);
  const id = String(f.get("id"));
  const doc = await prisma.document.findUniqueOrThrow({ where: { id } });
  try {
    const note =
      doc.type === "EAGLEVIEW"
        ? (await extractEagleView(id)).kept +
          " measurements read. Confirm them below."
        : (await extractPlansSpecs(id)).notes.join(" ");
    revalidatePath(path(doc.projectId));
    return { problems: [], ok: true, note };
  } catch (e) {
    await prisma.extractionRun.create({
      data: {
        documentId: id,
        kind: doc.type === "EAGLEVIEW" ? "EAGLEVIEW" : "PLANS_SPECS",
        status: "FAILED",
        message: aiErrorMessage(e),
      },
    });
    revalidatePath(path(doc.projectId));
    return { problems: [aiErrorMessage(e)] };
  }
}

export async function decideMeasurementAction(
  f: FormData,
): Promise<string | null> {
  const user = await requireUser([...EDITORS]);
  const id = String(f.get("id"));
  const decision = String(f.get("decision"));
  const m = await prisma.measurement.findUniqueOrThrow({ where: { id } });
  try {
    if (decision === "reject")
      await rejectMeasurement(
        id,
        user,
        String(f.get("reason") ?? "").trim() || null,
      );
    else {
      const raw = String(f.get("value") ?? "").trim();
      await confirmMeasurement(
        id,
        user,
        raw ? Number(raw.replace(/,/g, "")) : null,
      );
    }
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  revalidatePath(path(m.projectId));
  return null;
}

export async function decideFactAction(f: FormData): Promise<string | null> {
  const user = await requireUser([...EDITORS]);
  const id = String(f.get("id"));
  const fact = await prisma.extractedFact.findUniqueOrThrow({ where: { id } });
  try {
    await decideFact(
      id,
      user,
      f.get("decision") !== "reject",
      String(f.get("value") ?? "") || null,
    );
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  revalidatePath(path(fact.projectId));
  return null;
}

export async function addMeasurementAction(
  _: DocsResult,
  f: FormData,
): Promise<DocsResult> {
  const user = await requireUser([...EDITORS]);
  const projectId = String(f.get("projectId"));
  try {
    await addManualMeasurement(
      projectId,
      {
        key: String(f.get("key")),
        value: Number(String(f.get("value") ?? "").replace(/,/g, "")),
        facet: String(f.get("facet") ?? "").trim() || null,
        source: String(f.get("source") ?? ""),
      },
      user,
    );
  } catch (e) {
    return { problems: [e instanceof Error ? e.message : String(e)] };
  }
  revalidatePath(path(projectId));
  return { problems: [], ok: true };
}

export type PlanReviewResult = {
  problems: string[];
  ok?: boolean;
  note?: string;
  reviewId?: string;
} | null;

export async function planReviewAction(
  _: PlanReviewResult,
  f: FormData,
): Promise<PlanReviewResult> {
  const user = await requireUser([...EDITORS]);
  const id = String(f.get("id"));
  const doc = await prisma.document.findUniqueOrThrow({ where: { id } });
  try {
    const { review, message } = await runPlanReview(id, {
      pages: String(f.get("pages") ?? "").trim() || null,
      userId: user.id,
    });
    revalidatePath(`/projects/${doc.projectId}/plans`);
    revalidatePath(path(doc.projectId));
    return { problems: [], ok: true, note: message, reviewId: review.id };
  } catch (e) {
    await prisma.extractionRun.create({
      data: {
        documentId: id,
        kind: "PLAN_REVIEW",
        status: "FAILED",
        message: aiErrorMessage(e),
      },
    });
    revalidatePath(`/projects/${doc.projectId}/plans`);
    return { problems: [aiErrorMessage(e)] };
  }
}

/** Reprints an old Drive proposal in BTR's current proposal layout (added next to the original). */
export async function convertProposalAction(_: DocsResult, f: FormData): Promise<DocsResult> {
  const u = await requireUser([...EDITORS]);
  const id = String(f.get("id"));
  const doc = await prisma.document.findUniqueOrThrow({ where: { id }, select: { projectId: true } });
  try {
    const r = await convertOldProposal(id, u);
    revalidatePath(path(doc.projectId));
    return { problems: [], ok: true, note: r.duplicate ? `Already converted — see the (${appName()} format) copy.` : `Added a copy in the ${appName()} layout. Check the amounts against the original.` };
  } catch (e) {
    return { problems: [e instanceof LegacyProposalError ? e.message : aiErrorMessage(e)] };
  }
}

/** BTRbot reads a contract on the job and flags the risky clauses; opens the review. */
export async function contractReviewAction(_: DocsResult, f: FormData): Promise<DocsResult> {
  const u = await requireUser([...EDITORS]);
  const id = String(f.get("id"));
  let reviewId = "";
  let projectId = "";
  try {
    const r = await reviewContract(id, u);
    reviewId = r.id;
    projectId = r.projectId;
  } catch (e) {
    return { problems: [e instanceof ContractReviewError ? e.message : aiErrorMessage(e)] };
  }
  redirect(`/projects/${projectId}/contract-review/${reviewId}`);
}
