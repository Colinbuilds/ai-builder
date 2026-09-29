// The confirmation queue: people confirm, edit, or reject what was extracted; only CONFIRMED / USER_ENTERED values count.
import { prisma } from "@/lib/db";
import { INTAKE_BY_KEY } from "@/lib/projects/intake";
import { refreshReadiness } from "@/lib/projects/service";
import { MEASUREMENT_BY_KEY } from "./measurements";

type Actor = { id: string; name: string };

const docLabel = async (id: string | null, page: number | null) => {
  if (!id) return null;
  const d = await prisma.document.findUnique({ where: { id }, select: { fileName: true } });
  return d ? `${d.fileName}${page ? ` p.${page}` : ""}` : null;
};

/** Fills the matching intake field from a confirmed value, keeping the source reference. */
async function fillIntake(projectId: string, intakeKey: string, value: string, unit: string | null, source: string | null, actor: Actor) {
  const f = await prisma.intakeField.findUnique({ where: { projectId_key: { projectId, key: intakeKey } } });
  if (!f) return;
  await prisma.intakeField.update({
    where: { id: f.id },
    data: { value, unit: unit ?? f.unit, status: "VERIFIED", autoNa: false, note: source, approvedBy: actor.name },
  });
}

async function syncMeasurementToIntake(projectId: string, key: string, actor: Actor) {
  const def = MEASUREMENT_BY_KEY.get(key);
  if (!def || !("intake" in def) || !def.intake) return;
  const usable = await prisma.measurement.findMany({
    where: { projectId, key, status: { in: ["CONFIRMED", "USER_ENTERED"] } },
    orderBy: { updatedAt: "desc" },
  });
  if (!usable.length) return;
  const perFacet = "perFacet" in def && def.perFacet;
  const value = perFacet
    ? usable.map((m) => `${m.facet ? `${m.facet}: ` : ""}${m.value}${def.unit === "/12" ? "/12" : ` ${def.unit}`}`).join("; ")
    : String(usable[0].value);
  const src = await docLabel(usable[0].sourceDocId, usable[0].sourcePage);
  await fillIntake(projectId, def.intake, value, perFacet ? null : def.unit, src ?? usable[0].note, actor);
}

async function log(projectId: string, actor: Actor, text: string) {
  await prisma.projectActivity.create({ data: { projectId, userId: actor.id, kind: "measurement", text } });
}

export async function confirmMeasurement(id: string, actor: Actor, editedValue?: number | null) {
  const m = await prisma.measurement.findUniqueOrThrow({ where: { id } });
  if (m.status !== "EXTRACTED_PENDING") throw new Error("Only pending values can be confirmed.");
  if (editedValue != null && (!Number.isFinite(editedValue) || editedValue < 0)) throw new Error("Enter a valid number.");
  const edited = editedValue != null && editedValue !== m.value;
  await prisma.measurement.update({
    where: { id },
    data: {
      status: "CONFIRMED",
      value: edited ? editedValue : m.value,
      confirmedBy: actor.name,
      note: edited ? `Edited from ${m.extractedValue} by ${actor.name}` : m.note,
    },
  });
  const def = MEASUREMENT_BY_KEY.get(m.key);
  await log(m.projectId, actor, `${actor.name} confirmed ${def?.label ?? m.key}${m.facet ? ` (${m.facet})` : ""} = ${edited ? editedValue : m.value} ${m.unit ?? ""}${edited ? ` (AI read ${m.extractedValue})` : ""}`);
  await syncMeasurementToIntake(m.projectId, m.key, actor);
  await refreshReadiness(m.projectId);
}

export async function rejectMeasurement(id: string, actor: Actor, reason: string | null) {
  const m = await prisma.measurement.findUniqueOrThrow({ where: { id } });
  await prisma.measurement.update({ where: { id }, data: { status: "REJECTED", confirmedBy: actor.name, note: reason || `Rejected by ${actor.name}` } });
  await log(m.projectId, actor, `${actor.name} rejected ${MEASUREMENT_BY_KEY.get(m.key)?.label ?? m.key} = ${m.value}${reason ? ` — ${reason}` : ""}`);
}

export async function addManualMeasurement(
  projectId: string,
  input: { key: string; value: number; facet: string | null; source: string },
  actor: Actor,
) {
  const def = MEASUREMENT_BY_KEY.get(input.key);
  if (!def) throw new Error("Pick a measurement.");
  if (!Number.isFinite(input.value) || input.value < 0) throw new Error("Enter a valid number.");
  if (!input.source.trim()) throw new Error("Say where the number came from (document, page, or field measure).");
  await prisma.measurement.create({
    data: {
      projectId,
      key: input.key,
      value: input.value,
      unit: def.unit,
      facet: input.facet,
      status: "USER_ENTERED",
      confirmedBy: actor.name,
      note: input.source.trim(),
    },
  });
  await log(projectId, actor, `${actor.name} entered ${def.label}${input.facet ? ` (${input.facet})` : ""} = ${input.value} ${def.unit} — ${input.source.trim()}`);
  await syncMeasurementToIntake(projectId, input.key, actor);
  await refreshReadiness(projectId);
}

export async function decideFact(id: string, actor: Actor, accept: boolean, editedValue?: string | null) {
  const f = await prisma.extractedFact.findUniqueOrThrow({ where: { id }, include: { document: { select: { fileName: true } } } });
  if (f.status !== "PENDING") throw new Error("Already decided.");
  const value = editedValue?.trim() || f.value;
  await prisma.extractedFact.update({ where: { id }, data: { status: accept ? "CONFIRMED" : "REJECTED", value, decidedBy: actor.name } });
  const label = f.key === "spec_section" ? "Spec section" : (INTAKE_BY_KEY.get(f.key)?.label ?? f.key);
  await log(f.projectId, actor, `${actor.name} ${accept ? "confirmed" : "rejected"} ${label}: ${value}`);
  if (accept && f.key !== "spec_section") {
    await fillIntake(f.projectId, f.key, value, null, `${f.document.fileName}${f.page ? ` p.${f.page}` : ""}`, actor);
    await refreshReadiness(f.projectId);
  }
}
