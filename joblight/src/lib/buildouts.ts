import { z } from "zod";
import { prisma } from "./db";
import { buildoutMonthly } from "./pricing";
import { checkBuildout } from "./health";
import { TRADES } from "./trades";

const url = z
  .string()
  .trim()
  .transform((v) => v.replace(/\/+$/, ""))
  .refine((v) => v === "" || /^https?:\/\/[^\s]+$/.test(v), "Addresses start with http:// or https://")
  .transform((v) => v || null);
const optText = z.string().trim().max(2000).transform((v) => v || null);
const optMoney = z
  .string()
  .trim()
  .transform((v) => v.replace(/[$,\s]/g, ""))
  .refine((v) => v === "" || (Number.isFinite(Number(v)) && Number(v) >= 0), "Money is a number, zero or more")
  .transform((v) => (v === "" ? null : Number(v)));

export const BuildoutInput = z.object({
  company: z.string().trim().min(2, "Company name").max(160),
  trade: z.enum(TRADES.map((t) => t.key) as [string, ...string[]], { message: "Pick a trade" }),
  status: z.enum(["ONBOARDING", "LIVE", "PAUSED", "CANCELLED"]),
  url,
  internalUrl: url,
  railwayService: optText,
  branch: optText,
  users: z.coerce.number().int("Users is a whole number").min(1, "At least one user").max(5000),
  customMonthly: optMoney,
  setupFee: optMoney,
  setupPaid: z.preprocess((v) => v === "on" || v === true, z.boolean()),
  ownerName: optText,
  ownerEmail: z.string().trim().toLowerCase().refine((v) => v === "" || z.email().safeParse(v).success, "Owner email doesn't look right").transform((v) => v || null),
  protected: z.preprocess((v) => v === "on" || v === true, z.boolean()),
  notes: optText,
  leadId: optText.optional(),
});

export class BuildoutError extends Error {}

function parse(raw: Record<string, unknown>) {
  // a form leaves out empty optional fields; treat a missing one as blank
  const blanks = Object.fromEntries(["url", "internalUrl", "railwayService", "branch", "customMonthly", "setupFee", "ownerName", "ownerEmail", "notes"].map((k) => [k, ""]));
  const r = BuildoutInput.safeParse({ ...blanks, setupPaid: false, protected: false, ...raw });
  if (!r.success) throw new BuildoutError([...new Set(r.error.issues.map((i) => i.message))].join(" · "));
  if (r.data.users > 20 && r.data.customMonthly == null) throw new BuildoutError("Over 20 users needs an agreed monthly rate.");
  return r.data;
}

export async function createBuildout(raw: Record<string, unknown>) {
  const data = parse(raw);
  const b = await prisma.buildout.create({ data });
  if (data.leadId) await prisma.lead.update({ where: { id: data.leadId }, data: { status: "WON" } }).catch(() => null);
  return b;
}

export async function updateBuildout(id: string, raw: Record<string, unknown>) {
  const { leadId: _l, ...data } = parse(raw);
  return prisma.buildout.update({ where: { id }, data });
}

/** Health-checks one buildout (or every one not cancelled) and records the result. */
export async function runChecks(ids?: string[], fetcher?: typeof fetch) {
  const list = await prisma.buildout.findMany({ where: ids ? { id: { in: ids } } : { status: { not: "CANCELLED" } } });
  for (const b of list) {
    const c = await checkBuildout(b, fetcher);
    await prisma.buildout.update({ where: { id: b.id }, data: { lastCheckAt: new Date(), lastCheckOk: c.ok, lastCheckMs: c.ms, lastCheckError: c.error } });
  }
  return list.length;
}

/** Money and counts for the console header. Custom-rate buildouts with no agreed rate count as unknown. */
export async function summary() {
  const [buildouts, newLeads] = await Promise.all([prisma.buildout.findMany(), prisma.lead.count({ where: { status: "NEW" } })]);
  let mrr = 0;
  let unpriced = 0;
  for (const b of buildouts) {
    if (b.status !== "LIVE") continue;
    const m = buildoutMonthly(b);
    if (m == null) unpriced++;
    else mrr += m;
  }
  return {
    live: buildouts.filter((b) => b.status === "LIVE").length,
    onboarding: buildouts.filter((b) => b.status === "ONBOARDING").length,
    down: buildouts.filter((b) => b.status !== "CANCELLED" && b.lastCheckOk === false).length,
    mrr: Math.round(mrr * 100) / 100,
    unpriced,
    setupOwed: buildouts.filter((b) => b.setupFee && !b.setupPaid && b.status !== "CANCELLED").reduce((s, b) => s + (b.setupFee ?? 0), 0),
    newLeads,
  };
}
