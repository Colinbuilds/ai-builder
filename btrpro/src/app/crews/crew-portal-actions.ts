"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canSeeCosts } from "@/lib/costing/service";
import { CrewAuthError, setCrewLogin } from "@/lib/crew/login";
import { CrewError, addJobPhotos, markCrewInvoicePaid, reviewCrewInvoice, reviewPhoto } from "@/lib/crew/service";

export type OResult = { problems: string[]; ok?: boolean; note?: string } | null;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const msg = (e: unknown) => (e instanceof CrewError || e instanceof CrewAuthError || e instanceof Error ? e.message : String(e));

export async function crewLoginSetAction(_: OResult, f: FormData): Promise<OResult> {
  const u = await requireUser(["ADMIN"]);
  const crewId = str(f, "crewId");
  const off = f.get("off") === "1";
  try {
    await setCrewLogin(crewId, { email: str(f, "email"), password: off ? null : str(f, "password") }, u);
  } catch (e) {
    return { problems: [msg(e)] };
  }
  revalidatePath(`/crews/${crewId}`);
  return { problems: [], ok: true, note: off ? "Login turned off. The crew is signed out." : "Saved. Give the crew the email and password; the portal is at /crew on this site." };
}

export async function reviewCrewInvoiceAction(_: OResult, f: FormData): Promise<OResult> {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  try {
    // same rule as job costing: Admins, or the job's own estimator/salesperson
    const inv = await prisma.crewInvoice.findUniqueOrThrow({ where: { id: str(f, "id") }, select: { project: { select: { estimatorId: true, salespersonId: true } } } });
    if (!canSeeCosts(u, inv.project)) return { problems: ["Only an Admin or this job's estimator/salesperson can approve its invoices."] };
    await reviewCrewInvoice(str(f, "id"), str(f, "decision") === "REJECTED" ? "REJECTED" : "APPROVED", str(f, "note") || null, u);
  } catch (e) {
    return { problems: [msg(e)] };
  }
  revalidatePath("/crews/invoices");
  return { problems: [], ok: true };
}

export async function markPaidAction(f: FormData) {
  const u = await requireUser(["ADMIN"]);
  await markCrewInvoicePaid(str(f, "id"), u);
  revalidatePath("/crews/invoices");
}

export async function reviewPhotoAction(_: OResult, f: FormData): Promise<OResult> {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  try {
    const p = await reviewPhoto(str(f, "id"), str(f, "review") === "ISSUE" ? "ISSUE" : "OK", str(f, "note") || null, u);
    revalidatePath(`/projects/${p.projectId}/photos`);
  } catch (e) {
    return { problems: [msg(e)] };
  }
  return { problems: [], ok: true };
}

export async function staffPhotosAction(_: OResult, f: FormData): Promise<OResult> {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  const projectId = str(f, "projectId");
  try {
    const files = await Promise.all(
      f
        .getAll("photos")
        .filter((x): x is File => x instanceof File && x.size > 0)
        .map(async (x) => ({ bytes: new Uint8Array(await x.arrayBuffer()), name: x.name })),
    );
    const saved = await addJobPhotos({ crewId: null, name: u.name }, projectId, str(f, "stage"), files, str(f, "note") || null);
    revalidatePath(`/projects/${projectId}/photos`);
    return { problems: [], ok: true, note: `${saved.length} photo${saved.length === 1 ? "" : "s"} added.` };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}
