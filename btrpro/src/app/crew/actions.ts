"use server";

import { logExtraWork, reportIssue } from "@/lib/production/field";
import { addToolboxTalk } from "@/lib/safety/service";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { CREW_COOKIE, CREW_MAX_AGE, signCrewSession } from "@/lib/session";
import { requireCrew } from "@/lib/crew/auth";
import { checkCrewLogin } from "@/lib/crew/login";
import { CrewError, addJobPhotos, submitCrewInvoice } from "@/lib/crew/service";

export type CrewResult = { problems: string[]; ok?: boolean; note?: string } | null;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const msg = (e: unknown) => (e instanceof CrewError ? e.message : e instanceof Error ? e.message : String(e));

// simple per-process throttle on failed crew logins (by email + IP)
const fails = new Map<string, { n: number; until: number }>();

export async function crewLoginAction(_: CrewResult, f: FormData): Promise<CrewResult> {
  const email = str(f, "email").toLowerCase();
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? "?";
  const key = `${email}|${ip}`;
  const lock = fails.get(key);
  if (lock && lock.until > Date.now()) return { problems: ["Too many tries. Wait a few minutes or call the office."] };
  const crew = await checkCrewLogin(email, String(f.get("password") ?? ""));
  if (!crew) {
    const n = (lock?.n ?? 0) + 1;
    fails.set(key, { n, until: n >= 5 ? Date.now() + 10 * 60_000 : 0 });
    return { problems: ["Email or password is incorrect."] };
  }
  fails.delete(key);
  (await cookies()).set(CREW_COOKIE, await signCrewSession(crew.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CREW_MAX_AGE,
  });
  redirect("/crew");
}

export async function crewLogoutAction() {
  (await cookies()).delete(CREW_COOKIE);
  redirect("/crew/login");
}

const filesOf = async (f: FormData, k: string) =>
  Promise.all(
    f
      .getAll(k)
      .filter((x): x is File => x instanceof File && x.size > 0)
      .map(async (x) => ({ bytes: new Uint8Array(await x.arrayBuffer()), name: x.name || "photo" })),
  );

export async function crewPhotosAction(_: CrewResult, f: FormData): Promise<CrewResult> {
  const crew = await requireCrew();
  const projectId = str(f, "projectId");
  try {
    const saved = await addJobPhotos({ crewId: crew.id, name: crew.name }, projectId, str(f, "stage"), await filesOf(f, "photos"), str(f, "note") || null);
    revalidatePath(`/crew/jobs/${projectId}`);
    revalidatePath("/crew");
    return { problems: [], ok: true, note: `${saved.length} photo${saved.length === 1 ? "" : "s"} sent. Thank you.` };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}

export async function crewInvoiceAction(_: CrewResult, f: FormData): Promise<CrewResult> {
  const crew = await requireCrew();
  const projectId = str(f, "projectId");
  const amount = Number(str(f, "amount").replace(/[$,\s]/g, ""));
  const date = str(f, "invoiceDate");
  try {
    const [file] = await filesOf(f, "file");
    await submitCrewInvoice(crew.id, {
      projectId,
      invoiceNumber: str(f, "invoiceNumber") || null,
      invoiceDate: date ? new Date(`${date}T12:00:00Z`) : new Date(NaN),
      amount,
      description: str(f, "description"),
      file: file ?? null,
    });
    revalidatePath(`/crew/jobs/${projectId}`);
    revalidatePath("/crew");
    return { problems: [], ok: true, note: "Invoice sent to the office. You'll see it marked approved or sent back here." };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}

export async function crewIssueAction(_: CrewResult, f: FormData): Promise<CrewResult> {
  const crew = await requireCrew();
  const projectId = str(f, "projectId");
  try {
    await reportIssue({ crewId: crew.id, name: crew.name }, projectId, str(f, "note"), await filesOf(f, "photos"));
    revalidatePath(`/crew/jobs/${projectId}`);
    return { problems: [], ok: true, note: "Sent to the office. Don't do the extra work until BTR says it's approved." };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}

export async function crewExtraAction(_: CrewResult, f: FormData): Promise<CrewResult> {
  const crew = await requireCrew();
  const projectId = str(f, "projectId");
  const num = (k: string) => (str(f, k) ? Number(str(f, k)) : null);
  const date = str(f, "workDate");
  try {
    await logExtraWork(
      { crewId: crew.id, name: crew.name },
      projectId,
      {
        note: str(f, "note"),
        workDate: date ? new Date(`${date}T12:00:00Z`) : null,
        men: num("men"),
        hours: num("hours"),
        materials: str(f, "materials") || null,
        directedBy: str(f, "directedBy") || null,
        signerName: str(f, "signerName") || null,
        signatureImage: str(f, "signature") || null,
      },
      await filesOf(f, "photos"),
    );
    revalidatePath(`/crew/jobs/${projectId}`);
    return { problems: [], ok: true, note: "Extra work tag sent to the office. They'll price it into a change order." };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}

export async function crewTalkAction(_: CrewResult, f: FormData): Promise<CrewResult> {
  const crew = await requireCrew();
  const projectId = str(f, "projectId");
  try {
    if (!(await prisma.scheduleEvent.findFirst({ where: { projectId, crewId: crew.id } })) && !(await prisma.workOrder.findFirst({ where: { projectId, crewId: crew.id } }))) throw new CrewError("That job isn't assigned to your crew.");
    await addToolboxTalk({ date: new Date(), topic: str(f, "topic"), presenter: str(f, "presenter") || crew.name, crewId: crew.id, projectId, attendees: str(f, "attendees"), notes: null }, { name: crew.name });
    return { problems: [], ok: true, note: "Safety talk logged. Thank you." };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}
