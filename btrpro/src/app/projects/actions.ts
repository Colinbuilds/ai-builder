"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { parseScopes } from "@/lib/projects/intake";
import { STAGES, type Stage } from "@/lib/projects/workflow";
import {
  changeStage,
  createProject,
  executeForm17,
  ProjectError,
  updateIntakeField,
  updateProjectDetails,
  type ProjectInput,
} from "@/lib/projects/service";

const EDITORS = ["ADMIN", "ESTIMATOR"] as const;
export type ActionResult = {
  problems: string[];
  overridable?: boolean;
  ok?: boolean;
} | null;

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const date = (f: FormData, k: string) => {
  const v = str(f, k);
  return v ? new Date(`${v}T00:00:00Z`) : null;
};
const money = (f: FormData, k: string) => {
  const v = str(f, k);
  if (v == null) return null;
  const n = Number(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

const num = (f: FormData, k: string) => {
  const v = money(f, k);
  return v == null || Number.isNaN(v) ? null : v;
};

function detailsFromForm(f: FormData): ProjectInput {
  const ct = str(f, "constructionType");
  const market =
    str(f, "market") === "RESIDENTIAL" ? "RESIDENTIAL" : "COMMERCIAL";
  const res = market === "RESIDENTIAL";
  return {
    name: str(f, "name") ?? "",
    market,
    address: str(f, "address"),
    buildingUse: str(f, "buildingUse"),
    constructionType: ct === "NEW" || ct === "REROOF" ? ct : null,
    scopes: parseScopes(f.getAll("scopes")),
    isPublic: f.get("isPublic") === "on",
    isTaxExempt: !res && f.get("isTaxExempt") === "on",
    bidDueDate: date(f, "bidDueDate"),
    acculynxJobNumber: str(f, "acculynxJobNumber"),
    leadSource: str(f, "leadSource"),
    clientCompanyId: str(f, "clientCompanyId"),
    salespersonId: str(f, "salespersonId"),
    estimatorId: str(f, "estimatorId"),
    isInsuranceClaim: res && f.get("isInsuranceClaim") === "on",
    insuranceCarrier: res ? str(f, "insuranceCarrier") : null,
    claimNumber: res ? str(f, "claimNumber") : null,
    dateOfLoss: res ? date(f, "dateOfLoss") : null,
    adjusterName: res ? str(f, "adjusterName") : null,
    adjusterPhone: res ? str(f, "adjusterPhone") : null,
    adjusterEmail: res ? str(f, "adjusterEmail") : null,
    deductible: res ? num(f, "deductible") : null,
    bidBondRequired: !res && f.get("bidBondRequired") === "on",
    perfBondRequired: !res && f.get("perfBondRequired") === "on",
    prevailingWage: !res && f.get("prevailingWage") === "on",
    retainagePct: res ? null : num(f, "retainagePct"),
  };
}

const fail = (e: unknown): ActionResult => {
  if (e instanceof ProjectError)
    return { problems: e.problems, overridable: e.overridable };
  throw e;
};

export async function createProjectAction(
  _: ActionResult,
  f: FormData,
): Promise<ActionResult> {
  const user = await requireUser([...EDITORS]);
  const input = detailsFromForm(f);
  if (!input.scopes.length) return { problems: ["Pick at least one scope."] };
  let id: string;
  try {
    const homeowner =
      input.market === "RESIDENTIAL" &&
      str(f, "hoFirstName") &&
      str(f, "hoLastName")
        ? {
            firstName: str(f, "hoFirstName")!,
            lastName: str(f, "hoLastName")!,
            phone: str(f, "hoPhone"),
            email: str(f, "hoEmail"),
          }
        : null;
    if (input.market === "RESIDENTIAL" && !homeowner && !input.clientCompanyId)
      return {
        problems: [
          "Enter the homeowner's first and last name, or pick the builder.",
        ],
      };
    const appt = leadAppointment(f);
    if (appt && "problem" in appt) return { problems: [appt.problem] };
    ({ id } = await createProject(input, user, homeowner));
    await leadExtras(id, f, appt, input.salespersonId ?? null, user);
    await linkProperty(id, str(f, "propertyId"), input.clientCompanyId ?? null, true);
  } catch (e) {
    return fail(e);
  }
  redirect(`/projects/${id}`);
}

export async function updateDetailsAction(
  _: ActionResult,
  f: FormData,
): Promise<ActionResult> {
  const user = await requireUser([...EDITORS]);
  const id = String(f.get("id"));
  const input = detailsFromForm(f);
  if (!input.scopes.length) return { problems: ["Pick at least one scope."] };
  const contractAmount = money(f, "contractAmount");
  if (Number.isNaN(contractAmount))
    return { problems: ["Contract amount must be a number."] };
  try {
    await updateProjectDetails(
      id,
      {
        ...input,
        contractAmount,
        contractSignedAt: date(f, "contractSignedAt"),
      },
      user,
    );
    if (f.has("propertyId")) await linkProperty(id, str(f, "propertyId"), input.clientCompanyId ?? null, false);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/projects/${id}`);
  return { problems: [], ok: true };
}

export async function updateIntakeAction(
  _: ActionResult,
  f: FormData,
): Promise<ActionResult> {
  const user = await requireUser([...EDITORS]);
  const id = String(f.get("projectId"));
  const status = String(f.get("status")) as
    | "VERIFIED"
    | "MISSING"
    | "ASSUMED"
    | "NOT_APPLICABLE";
  try {
    await updateIntakeField(
      id,
      String(f.get("key")),
      {
        value: str(f, "value"),
        unit: str(f, "unit"),
        status,
        note: str(f, "note"),
      },
      user,
    );
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/projects/${id}`);
  return { problems: [], ok: true };
}

export async function changeStageAction(
  _: ActionResult,
  f: FormData,
): Promise<ActionResult> {
  const user = await requireUser([...EDITORS]);
  const id = String(f.get("id"));
  const to = String(f.get("to")) as Stage;
  if (!STAGES.includes(to)) return { problems: ["Pick a stage."] };
  try {
    await changeStage(
      id,
      to,
      {
        reason: str(f, "reason") ?? undefined,
        override: f.get("override") === "on",
      },
      user,
    );
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/projects/${id}`);
  revalidatePath("/");
  return { problems: [], ok: true };
}

export async function executeForm17Action(
  _: ActionResult,
  f: FormData,
): Promise<ActionResult> {
  const user = await requireUser([...EDITORS]);
  const id = String(f.get("id"));
  const executedAt = date(f, "executedAt");
  if (!executedAt)
    return { problems: ["Enter the date Form 17 was executed."] };
  try {
    await executeForm17(id, { executedAt, note: str(f, "note") }, user);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/projects/${id}`);
  revalidatePath("/");
  return { problems: [], ok: true };
}

export async function addProjectContactAction(
  _: ActionResult,
  f: FormData,
): Promise<ActionResult> {
  const user = await requireUser([...EDITORS]);
  const projectId = String(f.get("projectId"));
  const contactId = str(f, "contactId");
  const role = String(f.get("role"));
  if (!contactId) return { problems: ["Pick a contact."] };
  const exists = await prisma.projectContact.findUnique({
    where: { projectId_contactId: { projectId, contactId } },
  });
  if (exists) return { problems: ["That contact is already on this job."] };
  const c = await prisma.projectContact.create({
    data: {
      projectId,
      contactId,
      role: role as never,
      isPrimary: f.get("isPrimary") === "on",
    },
    include: { contact: true },
  });
  await prisma.projectActivity.create({
    data: {
      projectId,
      userId: user.id,
      kind: "contact",
      text: `${user.name} added ${c.contact.firstName} ${c.contact.lastName} (${role.replace(/_/g, " ").toLowerCase()})`,
    },
  });
  revalidatePath(`/projects/${projectId}`);
  return { problems: [], ok: true };
}

export async function setMarketView(f: FormData) {
  const v = String(f.get("market"));
  const { cookies } = await import("next/headers");
  (await cookies()).set(
    "ep_market",
    ["RESIDENTIAL", "COMMERCIAL"].includes(v) ? v : "ALL",
    {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    },
  );
  revalidatePath("/", "layout");
}

export async function removeProjectContactAction(f: FormData) {
  const user = await requireUser([...EDITORS]);
  const pc = await prisma.projectContact.delete({
    where: { id: String(f.get("id")) },
    include: { contact: true },
  });
  await prisma.projectActivity.create({
    data: {
      projectId: pc.projectId,
      userId: user.id,
      kind: "contact",
      text: `${user.name} removed ${pc.contact.firstName} ${pc.contact.lastName}`,
    },
  });
  revalidatePath(`/projects/${pc.projectId}`);
}

// ---------- new-lead extras: priority, notes, first appointment ----------

const t12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

function leadAppointment(f: FormData): { date: Date; when: string } | { problem: string } | null {
  const d = str(f, "apptDate");
  const a = str(f, "apptStart");
  const b = str(f, "apptEnd");
  if (!d) return a || b ? { problem: "Pick the appointment date, or clear the times." } : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { problem: "Pick the appointment date." };
  if (a && b && b <= a) return { problem: "The appointment ends before it starts." };
  return { date: new Date(`${d}T12:00:00Z`), when: a ? `${t12(a)}${b ? `–${t12(b)}` : ""}` : "" };
}

/** Ties the job to one of the client's properties; on a new job the site's staff become job contacts. */
async function linkProperty(projectId: string, propertyId: string | null, companyId: string | null, addStaff: boolean) {
  const prop = propertyId && companyId ? await prisma.property.findFirst({ where: { id: propertyId, companyId }, include: { contacts: true } }) : null;
  await prisma.project.update({ where: { id: projectId }, data: { propertyId: prop?.id ?? null } });
  if (!prop || !addStaff) return;
  const primary = prop.contacts.find((c) => /manager/i.test(c.title ?? "") && !/regional|assistant/i.test(c.title ?? ""))?.id;
  for (const c of prop.contacts)
    await prisma.projectContact.upsert({
      where: { projectId_contactId: { projectId, contactId: c.id } },
      update: {},
      create: { projectId, contactId: c.id, role: "PROPERTY_MANAGER", isPrimary: c.id === primary },
    });
}

async function leadExtras(
  projectId: string,
  f: FormData,
  appt: { date: Date; when: string } | null,
  assigneeId: string | null,
  user: { id: string; name: string },
) {
  if (str(f, "priority") === "HIGH") await prisma.project.update({ where: { id: projectId }, data: { priority: "HIGH" } });
  const notes = str(f, "notes")?.slice(0, 1000);
  if (notes) await prisma.jobMessage.create({ data: { projectId, authorId: user.id, body: `Lead notes: ${notes}`, mentions: [] } });
  if (appt) {
    const who = assigneeId ? await prisma.user.findUnique({ where: { id: assigneeId }, select: { name: true } }) : null;
    const title = `Initial appointment${appt.when ? ` ${appt.when}` : ""}${who ? ` — ${who.name}` : ""}`;
    await prisma.scheduleEvent.create({ data: { projectId, kind: "APPOINTMENT", title, startDate: appt.date, endDate: appt.date, status: "CONFIRMED", createdBy: user.name } });
    await prisma.task.create({ data: { projectId, title, dueDate: appt.date, assigneeId: assigneeId ?? user.id, auto: `APPT:${projectId}`, createdBy: user.name } });
  }
}
