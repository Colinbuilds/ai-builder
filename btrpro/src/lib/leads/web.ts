// Customer request form (public link /quote). One submission = a LEAD job with the homeowner contact, the
// photos on the job, a task for the sales manager to assign a salesperson, and a page the customer keeps
// (/quote/<token>) to try looks on their own photo and see who's coming out.
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { BTR } from "@/lib/company";
import { saveUpload, readUpload } from "@/lib/storage";
import { emailConfigured, sendEmail } from "@/lib/email/send";
import { getSettings } from "@/lib/settings";
import { createProject } from "@/lib/projects/service";
import { leadName, scopesForWork, type WorkType } from "@/lib/projects/work-types";
import { IMAGE_TYPE, MAX_PHOTO_BYTES, imageKind, resized } from "@/lib/photos/images";
import { lookLabel, renderLook, renderReady, type Choices } from "@/lib/render";

export class LeadFormError extends Error {}

export const PROPERTY_TYPES = { HOME: "House", TOWNHOME: "Townhome / duplex", MULTIFAMILY: "Apartments / multifamily", COMMERCIAL: "Commercial building", CHURCH_SCHOOL: "Church, school or public building", OTHER: "Other" } as const;
export const RELATIONSHIPS = { OWNER: "I own it", PROPERTY_MANAGER: "I manage it", TENANT: "I rent / lease it", BUILDER: "I'm the builder or contractor", OTHER: "Other" } as const;
// customer words → BTRpro job types
export const WANTS = {
  ROOF_REPLACE: { label: "Replace my roof", types: ["REROOF"] },
  ROOF_REPAIR: { label: "Fix a leak or roof damage", types: ["REPAIR"] },
  NEW_ROOF: { label: "Roof on a new build", types: ["NEW_ROOF"] },
  SIDING: { label: "New siding", types: ["SIDING"] },
  SIDING_REPAIR: { label: "Siding repair", types: ["SIDING", "REPAIR"] },
  GUTTERS: { label: "Gutters", types: ["GUTTERS"] },
  WINDOWS: { label: "Windows", types: ["WINDOWS"] },
  STORM: { label: "Storm / hail damage check", types: ["REPAIR"] },
} as const satisfies Record<string, { label: string; types: WorkType[] }>;
export type Want = keyof typeof WANTS;
export const TIMELINES = { ASAP: "As soon as possible", MONTHS_1_3: "In the next 1–3 months", MONTHS_3_6: "In 3–6 months", PRICING: "Just getting pricing" } as const;
export const STORIES = ["1 story", "2 stories", "3+ stories", "Not sure"] as const;
export const ROOF_NOW = ["Asphalt shingles", "Metal", "Flat / low-slope", "Wood shake", "Tile", "Not sure"] as const;
const COMMERCIAL_TYPES = ["MULTIFAMILY", "COMMERCIAL", "CHURCH_SCHOOL"];

export type LeadInput = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  contactPref: string | null;
  textOk: boolean;
  street: string;
  city: string;
  state: string;
  zip: string;
  propertyType: string;
  relationship: string;
  wants: string[];
  description: string;
  stories: string | null;
  currentRoof: string | null;
  roofAge: string | null;
  insurance: boolean;
  insuranceCarrier: string | null;
  claimNumber: string | null;
  dateOfLoss: string | null;
  timeline: string | null;
  heardFrom: string | null;
  inspectionTimes: string | null;
};
export type Photo = { url: string; type: string };
export type Rendering = { url: string; label: string; choices: Choices; photo: number; favorite?: boolean; at: string };

const digits = (s: string) => s.replace(/\D/g, "");
export const prettyPhone = (s: string) => {
  const d = digits(s).replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : s.trim();
};

/** Everything a new job needs, checked; returns the list of problems (empty = good). */
export function checkLead(x: LeadInput, photoCount: number) {
  const p: string[] = [];
  if (!x.firstName.trim() || !x.lastName.trim()) p.push("Enter your first and last name.");
  if (digits(x.phone).replace(/^1(?=\d{10}$)/, "").length !== 10) p.push("Enter a 10-digit phone number.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x.email.trim())) p.push("Enter a valid email address.");
  if (!x.street.trim() || !x.city.trim()) p.push("Enter the property's street address and city.");
  if (!/^[A-Za-z]{2}$/.test(x.state.trim())) p.push("Enter the state (2 letters, e.g. NE).");
  if (!/^\d{5}(-\d{4})?$/.test(x.zip.trim())) p.push("Enter the 5-digit ZIP code.");
  if (!(x.propertyType in PROPERTY_TYPES)) p.push("Tell us what kind of property it is.");
  if (!(x.relationship in RELATIONSHIPS)) p.push("Tell us whether you own, manage or rent it.");
  if (!x.wants.some((w) => w in WANTS)) p.push("Pick at least one thing you'd like done.");
  if (x.description.trim().length < 10) p.push("Describe what you'd like done in a sentence or two.");
  if (photoCount < 1) p.push("Add at least one photo of the property (the front of the building is best).");
  if (photoCount > 8) p.push("Add up to 8 photos.");
  if (x.dateOfLoss && !/^\d{4}-\d{2}-\d{2}$/.test(x.dateOfLoss)) p.push("Pick the storm date from the calendar, or leave it blank.");
  return p;
}

const fullAddress = (x: Pick<LeadInput, "street" | "city" | "state" | "zip">) => `${x.street.trim()}, ${x.city.trim()}, ${x.state.trim().toUpperCase()} ${x.zip.trim()}`;

/** Who gets told about new requests: the sales manager from Settings, else every Admin. */
export async function salesManagers() {
  const s = await getSettings();
  if (s.salesManagerId) {
    const u = await prisma.user.findFirst({ where: { id: s.salesManagerId }, select: { id: true, name: true, email: true } });
    if (u) return [u];
  }
  return prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true, name: true, email: true } });
}

const appUrl = () => process.env.APP_URL ?? "";
export const requestUrl = (token: string) => `${appUrl()}/quote/${token}`;
const mail = async (to: string | null | undefined, subject: string, text: string) => {
  if (!to || !emailConfigured()) return false;
  return sendEmail({ to, subject, text }).then(
    () => true,
    (e) => (console.error("web lead email failed", e), false),
  );
};

export async function submitWebLead(x: LeadInput, files: { bytes: Uint8Array; name: string }[], meta: { ip: string | null }) {
  const real = files.filter((f) => f.bytes.length);
  const problems = checkLead(x, real.length);
  if (problems.length) throw new LeadFormError(problems.join(" "));
  if (meta.ip && (await prisma.webLead.count({ where: { ip: meta.ip, createdAt: { gte: new Date(Date.now() - 86_400_000) } } })) >= 5)
    throw new LeadFormError(`We already have several requests from this connection today. Please call us at ${BTR.phone}.`);

  // photos: real images only, stored as upright JPEGs
  const token = randomBytes(18).toString("base64url");
  const photos: Photo[] = [];
  for (const f of real) {
    if (f.bytes.length > MAX_PHOTO_BYTES) throw new LeadFormError(`${f.name} is over 20 MB.`);
    const kind = imageKind(f.bytes);
    if (!kind) throw new LeadFormError(`${f.name || "One of the files"} isn't a photo.`);
    const jpeg = await resized(f.bytes, 2400, 85);
    photos.push({ url: await saveUpload(jpeg ?? f.bytes, jpeg ? "photo.jpg" : `photo.${kind}`, `web-leads/${token}`), type: jpeg ? "image/jpeg" : IMAGE_TYPE[kind] });
  }

  const wants = x.wants.filter((w): w is Want => w in WANTS);
  const types = [...new Set(wants.flatMap((w) => WANTS[w].types))] as WorkType[];
  const market = COMMERCIAL_TYPES.includes(x.propertyType) ? "COMMERCIAL" : "RESIDENTIAL";
  const { scopes, constructionType } = scopesForWork(types, market);
  const actor = { id: null, name: "Website request form" };
  const job = await createProject(
    {
      name: leadName(x.firstName, x.lastName, null, types),
      market,
      address: fullAddress(x),
      buildingUse: PROPERTY_TYPES[x.propertyType as keyof typeof PROPERTY_TYPES],
      constructionType,
      scopes: scopes.length ? scopes : market === "RESIDENTIAL" ? ["STEEP"] : ["LOW_SLOPE"],
      workTypes: types,
      isPublic: x.propertyType === "CHURCH_SCHOOL",
      isTaxExempt: false,
      leadSource: `Website request form${x.heardFrom?.trim() ? ` — heard from: ${x.heardFrom.trim()}` : ""}`,
      isInsuranceClaim: x.insurance,
      insuranceCarrier: x.insurance ? x.insuranceCarrier?.trim() || null : null,
      claimNumber: x.insurance ? x.claimNumber?.trim() || null : null,
      dateOfLoss: x.insurance && x.dateOfLoss ? new Date(`${x.dateOfLoss}T12:00:00Z`) : null,
    },
    actor,
    { firstName: x.firstName.trim(), lastName: x.lastName.trim(), phone: prettyPhone(x.phone), email: x.email.trim(), role: x.relationship === "OWNER" ? "HOMEOWNER" : "OWNER_REP" },
  );
  for (const [i, ph] of photos.entries())
    await prisma.document.create({ data: { projectId: job.id, type: "PHOTO", fileName: `Customer photo ${i + 1}.jpg`, fileUrl: ph.url, source: "UPLOAD", contentType: ph.type } });
  if (x.timeline === "ASAP" || x.insurance) await prisma.project.update({ where: { id: job.id }, data: { priority: "HIGH" } });

  const lead = await prisma.webLead.create({
    data: {
      token,
      projectId: job.id,
      firstName: x.firstName.trim(),
      lastName: x.lastName.trim(),
      phone: prettyPhone(x.phone),
      email: x.email.trim().toLowerCase(),
      contactPref: x.contactPref,
      textOk: x.textOk,
      street: x.street.trim(),
      city: x.city.trim(),
      state: x.state.trim().toUpperCase(),
      zip: x.zip.trim(),
      propertyType: x.propertyType,
      relationship: x.relationship,
      workTypes: wants,
      description: x.description.trim().slice(0, 4000),
      stories: x.stories,
      currentRoof: x.currentRoof,
      roofAge: x.roofAge?.trim() || null,
      insurance: x.insurance,
      insuranceCarrier: x.insuranceCarrier?.trim() || null,
      claimNumber: x.claimNumber?.trim() || null,
      dateOfLoss: x.dateOfLoss ? new Date(`${x.dateOfLoss}T12:00:00Z`) : null,
      timeline: x.timeline,
      heardFrom: x.heardFrom?.trim() || null,
      inspectionTimes: x.inspectionTimes?.trim().slice(0, 500) || null,
      photos,
      ip: meta.ip,
    },
  });
  await prisma.projectActivity.create({ data: { projectId: job.id, kind: "web_lead", text: `Website request: ${summary(lead)}` } });

  // the sales manager assigns it
  const managers = await salesManagers();
  for (const m of managers)
    await prisma.task.create({
      data: { projectId: job.id, title: `New website request: ${lead.firstName} ${lead.lastName}, ${lead.city} — assign a salesperson`, assigneeId: m.id, dueDate: new Date(), auto: `WEBLEAD:${lead.id}`, createdBy: actor.name },
    });
  for (const m of managers) await mail(m.email, `New website request — ${lead.firstName} ${lead.lastName}, ${lead.city}`, `${summary(lead)}\n\nAssign a salesperson: ${appUrl()}/leads/web\nJob: ${appUrl()}/projects/${job.id}`);
  await mail(
    lead.email,
    `${BTR.name} — we got your request`,
    `Hi ${lead.firstName},\n\nThanks for reaching out to ${BTR.name}. A project consultant will call you at ${lead.phone} to set up a free inspection.\n\nYour request, photos and design ideas: ${requestUrl(token)}\n\n${BTR.name} · ${BTR.phone}`,
  );
  return lead;
}

export function summary(l: { firstName: string; lastName: string; phone: string; email: string; street: string; city: string; state: string; workTypes: unknown; description: string; timeline: string | null; insurance: boolean; inspectionTimes: string | null }) {
  const wants = (l.workTypes as string[]).map((w) => WANTS[w as Want]?.label ?? w).join(", ");
  return [
    `${l.firstName} ${l.lastName} · ${l.phone} · ${l.email}`,
    `${l.street}, ${l.city}, ${l.state}`,
    `Wants: ${wants}${l.insurance ? " (insurance claim)" : ""}${l.timeline ? ` · ${TIMELINES[l.timeline as keyof typeof TIMELINES] ?? l.timeline}` : ""}`,
    `"${l.description}"`,
    l.inspectionTimes ? `Best times for an inspection: ${l.inspectionTimes}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function leadByToken(token: string) {
  if (!/^[\w-]{20,40}$/.test(token)) return null;
  return prisma.webLead.findUnique({ where: { token } });
}

// ---------- renderings (customer page) ----------
const MAX_RENDERS = 8;
export async function addRendering(token: string, photo: number, c: Choices) {
  const lead = await leadByToken(token);
  if (!lead) throw new LeadFormError("This request link isn't valid.");
  if (lead.renderCount >= MAX_RENDERS) throw new LeadFormError(`That's the most renderings we can make online. Your consultant can show more options at the inspection.`);
  const photos = lead.photos as Photo[];
  const ph = photos[photo];
  if (!ph) throw new LeadFormError("Pick one of your photos.");
  if (!lookLabel(c)) throw new LeadFormError("Pick a roof or siding color first.");
  // count the attempt first so a failing service can't be hit endlessly
  await prisma.webLead.update({ where: { id: lead.id }, data: { renderCount: { increment: 1 } } });
  // without a rendering service the picks are still saved for the salesperson (url "")
  let url = "";
  if (renderReady()) {
    const { image } = await renderLook(await readUpload(ph.url), c);
    url = await saveUpload(image, "rendering.jpg", `web-leads/${token}`);
  }
  const r: Rendering = { url, label: lookLabel(c), choices: c, photo, at: new Date().toISOString() };
  const list = [...((lead.renderings as Rendering[] | null) ?? []), r];
  await prisma.webLead.update({ where: { id: lead.id }, data: { renderings: list } });
  if (lead.projectId && url)
    await prisma.document.create({ data: { projectId: lead.projectId, type: "PHOTO", fileName: `Customer rendering ${list.length} — ${r.label}.jpg`, fileUrl: url, source: "UPLOAD", contentType: "image/jpeg" } });
  if (lead.projectId && !url) await prisma.projectActivity.create({ data: { projectId: lead.projectId, kind: "web_lead", text: `${lead.firstName} picked a look: ${r.label}` } });
  return r;
}

export async function setFavorite(token: string, index: number) {
  const lead = await leadByToken(token);
  if (!lead) throw new LeadFormError("This request link isn't valid.");
  const list = ((lead.renderings as Rendering[] | null) ?? []).map((r, i) => ({ ...r, favorite: i === index ? !r.favorite : r.favorite }));
  await prisma.webLead.update({ where: { id: lead.id }, data: { renderings: list } });
  const fav = list[index];
  if (fav?.favorite && lead.projectId) await prisma.projectActivity.create({ data: { projectId: lead.projectId, kind: "web_lead", text: `${lead.firstName} likes this look: ${fav.label}` } });
}

// ---------- staff: assign and schedule ----------
type Actor = { id: string; name: string };

export async function assignWebLead(id: string, salespersonId: string, actor: Actor) {
  const [lead, rep] = await Promise.all([prisma.webLead.findUniqueOrThrow({ where: { id } }), prisma.user.findFirst({ where: { id: salespersonId }, select: { id: true, name: true, email: true } })]);
  if (!rep) throw new LeadFormError("Pick a salesperson.");
  await prisma.webLead.update({ where: { id }, data: { assignedToId: rep.id, assignedAt: new Date(), assignedBy: actor.name, status: lead.status === "SCHEDULED" ? "SCHEDULED" : "ASSIGNED" } });
  if (lead.projectId) {
    await prisma.project.update({ where: { id: lead.projectId }, data: { salespersonId: rep.id, estimatorId: rep.id } });
    await prisma.projectActivity.create({ data: { projectId: lead.projectId, userId: actor.id, kind: "web_lead", text: `${actor.name} assigned the website request to ${rep.name}` } });
  }
  await prisma.task.updateMany({ where: { auto: `WEBLEAD:${id}`, doneAt: null }, data: { doneAt: new Date(), doneBy: actor.name } });
  await prisma.task.deleteMany({ where: { auto: `WEBLEAD-CALL:${id}`, doneAt: null } });
  await prisma.task.create({
    data: {
      projectId: lead.projectId,
      title: `Call ${lead.firstName} ${lead.lastName} (${lead.phone}) to set up the inspection${lead.inspectionTimes ? ` — prefers ${lead.inspectionTimes.slice(0, 80)}` : ""}`,
      assigneeId: rep.id,
      dueDate: new Date(),
      auto: `WEBLEAD-CALL:${id}`,
      createdBy: actor.name,
    },
  });
  await mail(rep.email, `Website request assigned to you — ${lead.firstName} ${lead.lastName}, ${lead.city}`, `${summary(lead)}\n\nCall them to set up the inspection, then mark it scheduled: ${appUrl()}/leads/web\nJob: ${appUrl()}/projects/${lead.projectId}`);
  return rep;
}

export async function scheduleInspection(id: string, input: { date: string; time: string }, actor: Actor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new LeadFormError("Pick the inspection date.");
  const lead = await prisma.webLead.findUniqueOrThrow({ where: { id } });
  const day = new Date(`${input.date}T12:00:00Z`);
  const when = input.time ? new Date(`2000-01-01T${input.time}:00`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
  const rep = lead.assignedToId ? await prisma.user.findUnique({ where: { id: lead.assignedToId }, select: { name: true } }) : null;
  const title = `Inspection${when ? ` ${when}` : ""} — ${lead.firstName} ${lead.lastName}${rep ? ` (${rep.name})` : ""}`;
  if (lead.projectId) {
    await prisma.scheduleEvent.create({ data: { projectId: lead.projectId, kind: "INSPECTION", title, startDate: day, endDate: day, status: "CONFIRMED", notes: lead.description.slice(0, 500), createdBy: actor.name } });
    await prisma.projectActivity.create({ data: { projectId: lead.projectId, userId: actor.id, kind: "web_lead", text: `${actor.name} scheduled the inspection: ${input.date}${when ? ` ${when}` : ""}` } });
    await prisma.project.update({ where: { id: lead.projectId }, data: { firstContactAt: new Date() } }).catch(() => {});
  }
  await prisma.webLead.update({ where: { id }, data: { status: "SCHEDULED", inspectionAt: day, inspectionWhen: when || null } });
  await prisma.task.updateMany({ where: { auto: `WEBLEAD-CALL:${id}`, doneAt: null }, data: { doneAt: new Date(), doneBy: actor.name } });
  const nice = day.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
  await mail(lead.email, `${BTR.name} — your inspection is set for ${nice}`, `Hi ${lead.firstName},\n\nYour free inspection at ${lead.street} is set for ${nice}${when ? ` at ${when}` : ""}${rep ? ` with ${rep.name.split(" ")[0]}` : ""}.\n\nYour request and design ideas: ${requestUrl(lead.token)}\n\nNeed to change it? Call ${BTR.phone}.\n\n${BTR.name}`);
}

export async function closeWebLead(id: string, actor: Actor) {
  await prisma.webLead.update({ where: { id }, data: { status: "CLOSED" } });
  await prisma.task.updateMany({ where: { auto: { in: [`WEBLEAD:${id}`, `WEBLEAD-CALL:${id}`] }, doneAt: null }, data: { doneAt: new Date(), doneBy: actor.name } });
}
