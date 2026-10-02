// Safety log and the prequalification packet GCs ask for before they'll let a sub bid: OSHA 300A summary
// for the last 3 years, TRIR / DART rates, EMR on the carrier's letter, COI, bonding letter, safety program.
// Rates use OSHA's formula: cases × 200,000 ÷ hours worked (200,000 = 100 full-time workers for a year).
import { PDFDocument } from "pdf-lib";
import { prisma } from "@/lib/db";
import { round } from "@/lib/calc/core";
import { BTR } from "@/lib/company";
import { PdfWriter } from "@/lib/pdf/writer";
import { readUpload, saveUpload } from "@/lib/storage";

export class SafetyError extends Error {}

export const INCIDENT_KINDS = {
  OBSERVATION: "Safety observation",
  NEAR_MISS: "Near miss",
  FIRST_AID: "First aid only",
  RECORDABLE: "Recordable (medical treatment)",
  RESTRICTED: "Restricted duty / job transfer",
  LOST_TIME: "Days away from work",
  FATALITY: "Fatality",
} as const;
export type IncidentKind = keyof typeof INCIDENT_KINDS;
const RECORDABLE: IncidentKind[] = ["RECORDABLE", "RESTRICTED", "LOST_TIME", "FATALITY"];
const DART: IncidentKind[] = ["RESTRICTED", "LOST_TIME"];

export const FILE_KINDS = {
  COI: "Certificate of insurance (GL / auto / umbrella)",
  WC: "Workers' comp certificate",
  EMR_LETTER: "EMR letter from the insurance carrier",
  BOND_LETTER: "Bonding capacity letter from the surety",
  SAFETY_MANUAL: "Written safety program / manual",
  W9: "W-9",
  LICENSE: "Contractor registration / license",
  OTHER: "Other",
} as const;
export type FileKind = keyof typeof FILE_KINDS;
// what nearly every GC prequal form asks for
export const PACKET_KINDS: FileKind[] = ["COI", "WC", "EMR_LETTER", "BOND_LETTER", "SAFETY_MANUAL", "W9", "LICENSE"];

/** OSHA rate: cases × 200,000 ÷ hours. Null without hours. */
export const oshaRate = (cases: number, hours: number | null | undefined) => (hours ? round((cases * 200_000) / hours, 2) : null);

export async function addIncident(x: { date: Date; kind: string; personName: string | null; crewId: string | null; projectId: string | null; description: string; daysAway: number | null; daysRestricted: number | null; correctiveAction: string | null }, actor: { name: string }) {
  if (!(x.kind in INCIDENT_KINDS)) throw new SafetyError("Pick what kind of incident it was.");
  if (!x.description.trim()) throw new SafetyError("Describe what happened.");
  if (Number.isNaN(x.date.getTime()) || x.date > new Date(Date.now() + 86_400_000)) throw new SafetyError("Enter the date it happened.");
  for (const n of [x.daysAway, x.daysRestricted]) if (n != null && (!Number.isInteger(n) || n < 0 || n > 180)) throw new SafetyError("Days must be a whole number (OSHA caps the count at 180).");
  return prisma.safetyIncident.create({ data: { ...x, description: x.description.trim(), personName: x.personName?.trim() || null, correctiveAction: x.correctiveAction?.trim() || null, createdBy: actor.name } });
}

export async function addToolboxTalk(x: { date: Date; topic: string; presenter: string; crewId: string | null; projectId: string | null; attendees: string; notes: string | null }, actor: { name: string }) {
  const names = x.attendees.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  if (!x.topic.trim()) throw new SafetyError("Enter the topic (e.g. fall protection at roof edges).");
  if (!x.presenter.trim()) throw new SafetyError("Who gave the talk?");
  if (!names.length) throw new SafetyError("List who attended, one name per line.");
  if (Number.isNaN(x.date.getTime())) throw new SafetyError("Enter the date.");
  return prisma.toolboxTalk.create({ data: { ...x, topic: x.topic.trim(), presenter: x.presenter.trim(), attendees: names.join("\n"), notes: x.notes?.trim() || null, createdBy: actor.name } });
}

export async function saveSafetyYear(year: number, x: { hoursWorked: number | null; avgEmployees: number | null; emr: number | null }, actor: { name: string }) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new SafetyError("Pick a year.");
  if (x.emr != null && (x.emr <= 0 || x.emr > 5)) throw new SafetyError("EMR is usually between 0.5 and 2.0 — check the carrier letter.");
  if (x.hoursWorked != null && x.hoursWorked < 0) throw new SafetyError("Hours worked can't be negative.");
  return prisma.safetyYear.upsert({ where: { year }, create: { year, ...x, updatedBy: actor.name }, update: { ...x, updatedBy: actor.name } });
}

export async function addCompanyFile(x: { kind: string; title: string; bytes: Uint8Array; fileName: string; contentType: string | null; expiresAt: Date | null }, actor: { name: string }) {
  if (!(x.kind in FILE_KINDS)) throw new SafetyError("Pick what the file is.");
  if (!x.bytes.length) throw new SafetyError("Choose the file.");
  if (x.bytes.length > 25_000_000) throw new SafetyError("Files must be under 25 MB.");
  const fileUrl = await saveUpload(x.bytes, x.fileName || "file.pdf", "company");
  return prisma.companyFile.create({ data: { kind: x.kind, title: x.title.trim() || FILE_KINDS[x.kind as FileKind], fileUrl, contentType: x.contentType, expiresAt: x.expiresAt, uploadedBy: actor.name } });
}

/** One year of the 300A summary, computed from the incident log. */
export async function yearSummary(year: number) {
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  const [rows, y] = await Promise.all([prisma.safetyIncident.findMany({ where: { date: { gte: from, lt: to } } }), prisma.safetyYear.findUnique({ where: { year } })]);
  const n = (k: IncidentKind[]) => rows.filter((r) => k.includes(r.kind as IncidentKind)).length;
  const recordable = n(RECORDABLE);
  const dart = n(DART);
  return {
    year,
    hoursWorked: y?.hoursWorked ?? null,
    avgEmployees: y?.avgEmployees ?? null,
    emr: y?.emr ?? null,
    deaths: n(["FATALITY"]),
    daysAwayCases: n(["LOST_TIME"]),
    restrictedCases: n(["RESTRICTED"]),
    otherRecordable: n(["RECORDABLE"]),
    recordable,
    daysAway: rows.reduce((a, r) => a + (r.daysAway ?? 0), 0),
    daysRestricted: rows.reduce((a, r) => a + (r.daysRestricted ?? 0), 0),
    trir: oshaRate(recordable, y?.hoursWorked),
    dartRate: oshaRate(dart, y?.hoursWorked),
    nearMisses: n(["NEAR_MISS", "OBSERVATION", "FIRST_AID"]),
  };
}

const DAY = 86_400_000;

/** Everything on the safety page: 3 completed years + this year, talks, files and what the packet is missing. */
export async function safetyOverview(now = new Date()) {
  const y = now.getUTCFullYear();
  const years = await Promise.all([y, y - 1, y - 2, y - 3].map(yearSummary));
  const since30 = new Date(now.getTime() - 30 * DAY);
  const [talks, incidents, files, crews] = await Promise.all([
    prisma.toolboxTalk.findMany({ orderBy: { date: "desc" }, take: 40 }),
    prisma.safetyIncident.findMany({ orderBy: { date: "desc" }, take: 40 }),
    prisma.companyFile.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.crew.findMany({ where: { active: true }, select: { id: true, name: true } }),
  ]);
  const talks30 = talks.filter((t) => t.date >= since30);
  const crewTalks = crews.map((c) => ({ ...c, talks30: talks30.filter((t) => t.crewId === c.id).length })).sort((a, b) => a.talks30 - b.talks30);
  // latest file per kind; expired files don't count
  const latest = new Map<string, (typeof files)[number]>();
  for (const f of files) if (!latest.has(f.kind)) latest.set(f.kind, f);
  const missing: string[] = [];
  for (const k of PACKET_KINDS) {
    const f = latest.get(k);
    if (!f) missing.push(FILE_KINDS[k]);
    else if (f.expiresAt && f.expiresAt < now) missing.push(`${FILE_KINDS[k]} (expired ${f.expiresAt.toISOString().slice(0, 10)})`);
  }
  for (const s of years.slice(1)) {
    if (s.hoursWorked == null) missing.push(`${s.year} hours worked (for TRIR / DART)`);
    if (s.emr == null && s.year >= y - 3) missing.push(`${s.year} EMR`);
  }
  return { years, talks, talks30: talks30.length, crewTalks, incidents, files, latest, missing };
}

/**
 * The prequal packet: a cover page with the company facts and the 3-year safety table, then every current
 * company file (PDFs merged in, photos placed one per page). Built from what's on file — nothing is filled in.
 */
export async function prequalPacket(now = new Date()) {
  const o = await safetyOverview(now);
  const w = await PdfWriter.create({ title: `${BTR.name} prequalification packet`, footer: `${BTR.name} · ${BTR.phone} · prepared ${now.toISOString().slice(0, 10)}` });
  w.heading(`${BTR.name} — subcontractor prequalification`);
  w.text(`${BTR.address} · ${BTR.phone}`, { size: 10, gap: 10 });
  w.text("Safety record (OSHA 300A summary; rates = cases x 200,000 / hours worked)", { bold: true, size: 11, gap: 4 });
  const done = o.years.slice(1).reverse();
  const v = (n: number | null, d = 2) => (n == null ? "not on file" : n.toFixed(d));
  w.table(
    [
      { header: "Year", width: 50 },
      { header: "Hours worked", width: 80, align: "right" },
      { header: "Avg employees", width: 70, align: "right" },
      { header: "Recordables", width: 65, align: "right" },
      { header: "Days-away cases", width: 70, align: "right" },
      { header: "TRIR", width: 50, align: "right" },
      { header: "DART", width: 50, align: "right" },
      { header: "EMR", width: 50, align: "right" },
    ],
    done.map((s) => [String(s.year), s.hoursWorked == null ? "not on file" : Math.round(s.hoursWorked).toLocaleString("en-US"), v(s.avgEmployees, 0), String(s.recordable), String(s.daysAwayCases), v(s.trir), v(s.dartRate), v(s.emr)]),
    { size: 9 },
  );
  w.text(`Fatalities in the last 3 years: ${done.reduce((a, s) => a + s.deaths, 0)}. Toolbox talks held in the last 30 days: ${o.talks30}.`, { size: 10, gap: 10 });
  w.text("Documents attached", { bold: true, size: 11, gap: 4 });
  const attach = PACKET_KINDS.map((k) => o.latest.get(k)).filter((f): f is NonNullable<typeof f> => !!f && !(f.expiresAt && f.expiresAt < now));
  for (const k of PACKET_KINDS) {
    const f = o.latest.get(k);
    w.text(`${f && !(f.expiresAt && f.expiresAt < now) ? "[x]" : "[ ] MISSING —"} ${FILE_KINDS[k]}${f?.expiresAt ? ` (expires ${f.expiresAt.toISOString().slice(0, 10)})` : ""}`, { size: 10, gap: 2 });
  }
  const out = await PDFDocument.load(await w.save());
  for (const f of attach) {
    const bytes = await readUpload(f.fileUrl);
    const type = f.contentType ?? (f.fileUrl.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
    try {
      if (type.includes("pdf")) {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
      } else if (/png|jpe?g/.test(type)) {
        const img = type.includes("png") ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        const page = out.addPage([612, 792]);
        const s = Math.min(532 / img.width, 712 / img.height, 1);
        page.drawImage(img, { x: 40, y: 792 - 40 - img.height * s, width: img.width * s, height: img.height * s });
      }
    } catch (e) {
      console.error("prequal packet: couldn't attach", f.title, e);
    }
  }
  return Buffer.from(await out.save());
}
