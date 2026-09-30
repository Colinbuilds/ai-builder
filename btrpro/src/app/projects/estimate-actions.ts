"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  applyTemplate,
  createEstimateFromTemplate,
  saveAsTemplate,
  updateTemplateMeta,
} from "@/lib/estimates/templates";
import {
  addLine,
  createEstimate,
  decideAiLine,
  createRevision,
  deleteLine,
  EstimateError,
  overrideQuantity,
  runTakeoff,
  saveTakeoff,
  setWaste,
  substituteLine,
  type ScopeType,
  type WasteSection,
} from "@/lib/estimates/service";
import {
  addLaborLine,
  deleteLaborLine,
  saveLaborStandard,
} from "@/lib/estimates/labor";
import type { Module } from "@/lib/estimates/takeoff";

const EDITORS = ["ADMIN", "ESTIMATOR"] as const;
export type EstResult = {
  problems: string[];
  ok?: boolean;
  note?: string;
} | null;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const numOrNull = (f: FormData, k: string) => {
  const v = str(f, k);
  if (v == null) return null;
  const n = Number(v.replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};
async function revalidateEstimate(estimateId: string) {
  const e = await prisma.estimate.findUnique({
    where: { id: estimateId },
    select: { projectId: true },
  });
  if (e) {
    revalidatePath(`/projects/${e.projectId}/estimates/${estimateId}`);
    revalidatePath(`/projects/${e.projectId}`, "layout");
  }
}
const actor = async () => {
  const u = await requireUser([...EDITORS]);
  return { id: u.id, name: u.name, role: u.role };
};

export async function createEstimateAction(
  _: EstResult,
  f: FormData,
): Promise<EstResult> {
  const a = await actor();
  const projectId = String(f.get("projectId"));
  const scope = String(f.get("scopeType")) as ScopeType;
  const templateId = str(f, "templateId");
  let id: string;
  try {
    if (templateId)
      ({
        estimate: { id },
      } = await createEstimateFromTemplate(projectId, templateId, a));
    else ({ id } = await createEstimate(projectId, scope, a));
  } catch (e) {
    return { problems: [msg(e)] };
  }
  redirect(`/projects/${projectId}/estimates/${id}`);
}

export async function saveAndRunTakeoffAction(
  estimateId: string,
  module: Module,
  config: unknown,
  run: boolean,
): Promise<EstResult> {
  const a = await actor();
  try {
    await saveTakeoff(estimateId, module, config);
    if (run) {
      const lines = await runTakeoff(estimateId, module, a);
      await revalidateEstimate(estimateId);
      const missing = lines.filter((l) => l.missing.length).length;
      return {
        problems: [],
        ok: true,
        note: `${lines.length} lines calculated${missing ? `, ${missing} still missing inputs` : ""}.`,
      };
    }
  } catch (e) {
    return { problems: [msg(e)] };
  }
  await revalidateEstimate(estimateId);
  return { problems: [], ok: true, note: "Saved." };
}

export async function runTakeoffAction(f: FormData) {
  const a = await actor();
  const id = String(f.get("estimateId"));
  try {
    await runTakeoff(id, String(f.get("module")) as Module, a);
  } catch (e) {
    if (!(e instanceof EstimateError)) throw e;
  }
  await revalidateEstimate(id);
}

export async function setWasteAction(
  _: EstResult,
  f: FormData,
): Promise<EstResult> {
  const a = await actor();
  const id = String(f.get("estimateId"));
  const pct = numOrNull(f, "pct");
  if (Number.isNaN(pct)) return { problems: ["Waste must be a number."] };
  try {
    await setWaste(
      id,
      String(f.get("section")) as WasteSection,
      pct,
      f.get("approve") === "1",
      a,
    );
  } catch (e) {
    return { problems: [msg(e)] };
  }
  await revalidateEstimate(id);
  return { problems: [], ok: true };
}

export async function addLineAction(
  _: EstResult,
  f: FormData,
): Promise<EstResult> {
  const a = await actor();
  const id = String(f.get("estimateId"));
  const quantity = numOrNull(f, "quantity");
  const unitCost = numOrNull(f, "unitCost");
  if (Number.isNaN(quantity) || Number.isNaN(unitCost))
    return { problems: ["Quantity and cost must be numbers."] };
  try {
    await addLine(
      id,
      {
        section: String(f.get("section")) as "MATERIAL_ROOFING",
        itemNumber: str(f, "itemNumber"),
        itemName: str(f, "itemName") ?? "",
        quantity,
        unit: str(f, "unit"),
        unitCost,
        source: str(f, "source"),
        placeholder: f.get("placeholder") === "on",
      },
      a,
    );
  } catch (e) {
    return { problems: [msg(e)] };
  }
  await revalidateEstimate(id);
  return { problems: [], ok: true };
}

export async function lineAction(f: FormData): Promise<string | null> {
  const a = await actor();
  const lineId = String(f.get("lineId"));
  const kind = String(f.get("kind"));
  const line = await prisma.estimateLine.findUniqueOrThrow({
    where: { id: lineId },
  });
  try {
    if (kind === "delete") await deleteLine(lineId, a);
    else if (kind === "quantity")
      await overrideQuantity(
        lineId,
        Number(String(f.get("quantity")).replace(/,/g, "")),
        String(f.get("reason") ?? ""),
        a,
      );
    else if (kind === "accept_ai" || kind === "reject_ai")
      await decideAiLine(lineId, kind === "accept_ai", a);
    else if (kind === "substitute")
      await substituteLine(
        lineId,
        String(f.get("itemNumber") ?? ""),
        String(f.get("reason") ?? ""),
        a,
      );
  } catch (e) {
    return msg(e);
  }
  await revalidateEstimate(line.estimateId);
  return null;
}

export async function createRevisionAction(f: FormData) {
  const a = await actor();
  const e = await createRevision(String(f.get("estimateId")), a);
  redirect(`/projects/${e.projectId}/estimates/${e.id}`);
}

export async function setContingencyAction(f: FormData) {
  await actor();
  const id = String(f.get("estimateId"));
  const e = await prisma.estimate.findUniqueOrThrow({ where: { id } });
  if (e.locked) return;
  const v = numOrNull(f, "contingencyPct");
  await prisma.estimate.update({
    where: { id },
    data: { contingencyPct: v == null || Number.isNaN(v) ? null : v },
  });
  await revalidateEstimate(id);
}

export async function addLaborAction(
  _: EstResult,
  f: FormData,
): Promise<EstResult> {
  const a = await actor();
  const id = String(f.get("estimateId"));
  const nums = [
    "quantity",
    "crewSize",
    "productionRate",
    "hourlyRate",
    "burdenPct",
    "unitRate",
  ].map((k) => numOrNull(f, k));
  if (nums.some((x) => Number.isNaN(x)))
    return { problems: ["Numbers only in the labor fields."] };
  const [quantity, crewSize, productionRate, hourlyRate, burdenPct, unitRate] =
    nums;
  try {
    await addLaborLine(
      id,
      {
        task: str(f, "task") ?? "",
        quantity,
        quantityUnit: str(f, "quantityUnit"),
        quantitySource: str(f, "quantitySource"),
        standardId: str(f, "standardId"),
        crewSize,
        productionRate,
        hourlyRate,
        burdenPct,
        unitRate,
        rateSource: str(f, "rateSource"),
        placeholder: f.get("placeholder") === "on",
      },
      a,
    );
  } catch (e) {
    return { problems: [msg(e)] };
  }
  await revalidateEstimate(id);
  return { problems: [], ok: true };
}

export async function deleteLaborAction(f: FormData) {
  await actor();
  const id = String(f.get("id"));
  const l = await prisma.laborLine.findUniqueOrThrow({ where: { id } });
  await deleteLaborLine(id);
  await revalidateEstimate(l.estimateId);
}

export async function saveLaborStandardAction(
  _: EstResult,
  f: FormData,
): Promise<EstResult> {
  const a = await actor();
  const rate = numOrNull(f, "productionRate");
  const crew = numOrNull(f, "crewSize");
  const hourly = numOrNull(f, "hourlyRate");
  const burden = numOrNull(f, "burdenPct");
  const unitRate = numOrNull(f, "unitRate");
  if ([rate, crew, hourly, burden, unitRate].some((x) => Number.isNaN(x)))
    return { problems: ["Numbers only."] };
  const rateType = str(f, "rateType") === "UNIT" ? "UNIT" : "HOURLY";
  try {
    await saveLaborStandard(
      {
        id: str(f, "id") ?? undefined,
        task: str(f, "task") ?? "",
        rateType,
        unitRate: rateType === "UNIT" ? unitRate : null,
        category: str(f, "category"),
        productionRate: rateType === "UNIT" ? null : rate,
        unit: (str(f, "unit") ?? "").toUpperCase(),
        crewSize: rateType === "UNIT" ? null : crew,
        hourlyRate: rateType === "UNIT" ? null : hourly,
        burdenPct: rateType === "UNIT" ? null : burden,
        source: str(f, "source") ?? "",
      },
      a,
    );
  } catch (e) {
    return { problems: [msg(e)] };
  }
  revalidatePath("/settings/labor");
  return { problems: [], ok: true };
}

export async function openItemAction(f: FormData) {
  const a = await actor();
  const kind = String(f.get("kind"));
  if (kind === "add") {
    const estimateId = String(f.get("estimateId"));
    const e = await prisma.estimate.findUniqueOrThrow({
      where: { id: estimateId },
    });
    const text = str(f, "text");
    if (text)
      await prisma.openItem.create({
        data: {
          projectId: e.projectId,
          estimateId,
          text,
          owner: str(f, "owner"),
        },
      });
    await revalidateEstimate(estimateId);
  } else {
    const o = await prisma.openItem.update({
      where: { id: String(f.get("id")) },
      data: { resolved: kind === "resolve" },
    });
    await prisma.projectActivity.create({
      data: {
        projectId: o.projectId!,
        userId: a.id,
        kind: "estimate",
        text: `${a.name} ${kind === "resolve" ? "resolved" : "reopened"} open item: ${o.text}`,
      },
    });
    if (o.estimateId) await revalidateEstimate(o.estimateId);
  }
}

export async function scopeItemAction(f: FormData) {
  await actor();
  const estimateId = String(f.get("estimateId"));
  const e = await prisma.estimate.findUniqueOrThrow({
    where: { id: estimateId },
  });
  if (e.locked) return;
  if (f.get("kind") === "delete")
    await prisma.scopeItem.delete({ where: { id: String(f.get("id")) } });
  else {
    const text = str(f, "text");
    const type = f.get("type") === "WE_WILL_NOT" ? "WE_WILL_NOT" : "WE_WILL";
    if (text)
      await prisma.scopeItem.create({
        data: { estimateId, type, text, sortOrder: Date.now() % 1_000_000 },
      });
  }
  await revalidateEstimate(estimateId);
}

export async function applyTemplateAction(
  _: EstResult,
  f: FormData,
): Promise<EstResult> {
  const a = await actor();
  const estimateId = String(f.get("estimateId"));
  try {
    const r = await applyTemplate(estimateId, String(f.get("templateId")), a);
    await revalidateEstimate(estimateId);
    return {
      problems: [],
      ok: true,
      note: r.missing.length
        ? `Applied. Not on this job's pricing: ${r.missing.join(", ")} — those stay MISSING or flagged.`
        : "Applied. Run the takeoff to calculate quantities.",
    };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}

export async function saveAsTemplateAction(
  _: EstResult,
  f: FormData,
): Promise<EstResult> {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  const estimateId = String(f.get("estimateId"));
  try {
    const t = await saveAsTemplate(
      estimateId,
      {
        module: String(f.get("module")) as Module,
        name: str(f, "name") ?? "",
        category: str(f, "category") ?? "OTHER",
        group: str(f, "group") ?? "",
        brand: str(f, "brand"),
        impactClass: str(f, "impactClass"),
        impactSource: str(f, "impactSource"),
        notes: str(f, "notes"),
        replaceId: str(f, "replaceId"),
      },
      { id: u.id, name: u.name, role: u.role },
    );
    revalidatePath("/settings/templates");
    return { problems: [], ok: true, note: `Saved template "${t.name}".` };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}

export async function updateTemplateMetaAction(
  _: EstResult,
  f: FormData,
): Promise<EstResult> {
  const u = await requireUser(["ADMIN"]);
  try {
    await updateTemplateMeta(
      String(f.get("id")),
      {
        name: str(f, "name") ?? "",
        group: str(f, "group") ?? "",
        impactClass: str(f, "impactClass"),
        impactSource: str(f, "impactSource"),
        notes: str(f, "notes"),
        active: f.get("active") === "on",
      },
      { id: u.id, name: u.name, role: u.role },
    );
  } catch (e) {
    return { problems: [msg(e)] };
  }
  revalidatePath("/settings/templates");
  return { problems: [], ok: true };
}
