// Saving plan takeoffs and sending their totals to the job's measurements.
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { pageTotals, TYPE_BY_ID, type PageTakeoff } from "./geometry";

export class TakeoffError extends Error {}

const Pt = z.tuple([z.number().finite(), z.number().finite()]);
export const PageSchema = z.object({
  view: z.enum(["ROOF_PLAN", "ELEVATION", "OTHER"]),
  pitch: z.number().min(0).max(30).nullable(),
  scale: z
    .object({
      upf: z.number().positive().finite(),
      method: z.enum(["CALIBRATED", "PRESET"]),
      label: z.string().max(80),
      check: z.object({ expectedFt: z.number().positive(), measuredFt: z.number().positive(), diffPct: z.number() }).nullable().optional(),
    })
    .nullable(),
  items: z
    .array(
      z.object({
        id: z.string().max(40),
        type: z.string().refine((t) => TYPE_BY_ID.has(t), "unknown measurement type"),
        points: z.array(Pt).min(1).max(2000),
        pitch: z.number().min(0).max(30).nullable().optional(),
        note: z.string().max(200).nullable().optional(),
        ai: z.boolean().optional(),
      }),
    )
    .max(3000),
  width: z.number().positive().nullable().optional(),
  height: z.number().positive().nullable().optional(),
});
export type PageInput = z.infer<typeof PageSchema>;

export async function loadTakeoff(documentId: string, page: number): Promise<PageInput | null> {
  const t = await prisma.planTakeoff.findUnique({ where: { documentId_page: { documentId, page } } });
  if (!t) return null;
  return { view: t.view as PageInput["view"], pitch: t.pitch, scale: (t.scale as PageInput["scale"]) ?? null, items: (t.items as PageInput["items"]) ?? [], width: t.width, height: t.height };
}

export async function saveTakeoff(documentId: string, page: number, raw: unknown, actor: { name: string }) {
  const parsed = PageSchema.safeParse(raw);
  if (!parsed.success) throw new TakeoffError("That takeoff couldn't be saved: " + parsed.error.issues[0]?.message);
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { projectId: true } });
  if (!doc) throw new TakeoffError("That plan file is gone.");
  const d = parsed.data;
  const data = {
    view: d.view,
    pitch: d.pitch,
    scale: d.scale ? (d.scale as Prisma.InputJsonValue) : Prisma.JsonNull,
    items: d.items as Prisma.InputJsonValue,
    width: d.width ?? null,
    height: d.height ?? null,
    updatedBy: actor.name,
  };
  await prisma.planTakeoff.upsert({
    where: { documentId_page: { documentId, page } },
    update: data,
    create: { ...data, documentId, page, projectId: doc.projectId },
  });
}

const NOTE = "Plan takeoff";

/**
 * Replaces this sheet's measurements on the job with its current totals (allowance added, rounded up).
 * Each sheet keeps its own rows, so a job measured across several sheets adds up.
 */
export async function sendToJob(documentId: string, page: number, actor: { id: string; name: string }) {
  const t = await prisma.planTakeoff.findUnique({ where: { documentId_page: { documentId, page } }, include: { document: { select: { projectId: true, fileName: true } } } });
  if (!t) throw new TakeoffError("Save the takeoff first.");
  const pg: PageTakeoff = { view: t.view as PageTakeoff["view"], pitch: t.pitch, scale: (t.scale as PageTakeoff["scale"]) ?? null, items: (t.items as PageTakeoff["items"]) ?? [] };
  if (!pg.scale) throw new TakeoffError("Set the scale before sending measurements to the job.");
  if (pg.scale.check && Math.abs(pg.scale.check.diffPct) > 1) throw new TakeoffError("The scale check is off by more than 1%. Re-calibrate first.");
  const drafts = pg.items.filter((i) => i.ai).length;
  if (drafts) throw new TakeoffError(`${drafts} BTRbot-drawn item${drafts === 1 ? " is" : "s are"} still unreviewed. Accept or delete ${drafts === 1 ? "it" : "them"} before sending.`);
  const allowance = (await getSettings()).takeoffAllowancePct ?? 1;
  const { totals } = pageTotals(pg, allowance);
  if (!totals.length) throw new TakeoffError("Nothing on this sheet is measured yet.");
  const projectId = t.document.projectId;
  const where = `${t.document.fileName} p.${page}`;
  const scaleNote = `${pg.scale.label}${pg.scale.check ? `, checked ${pg.scale.check.diffPct >= 0 ? "+" : ""}${pg.scale.check.diffPct.toFixed(2)}%` : ", not checked"}`;
  await prisma.$transaction(async (tx) => {
    await tx.measurement.deleteMany({ where: { projectId, sourceDocId: documentId, sourcePage: page, note: { startsWith: NOTE } } });
    for (const tot of totals)
      await tx.measurement.create({
        data: {
          projectId,
          key: tot.key,
          value: tot.value,
          unit: tot.unit,
          sourceDocId: documentId,
          sourcePage: page,
          status: "USER_ENTERED",
          confirmedBy: actor.name,
          quote: tot.formula,
          note: `${NOTE} · ${where} · ${scaleNote} · ${actor.name}`,
        },
      });
    await tx.planTakeoff.update({ where: { id: t.id }, data: { savedToJob: new Date() } });
    await tx.projectActivity.create({
      data: { projectId, userId: actor.id, kind: "measurement", text: `${actor.name} sent plan takeoff totals from ${where} (${totals.length} measurements)` },
    });
  });
  return { count: totals.length, totals };
}
