// Who does what: which builders and crews each project manager runs, and what work each crew does.
// The office fills it in on Schedule → Who does what; BTRpro suggests answers from the schedule itself.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const CREW_SCOPES = [
  "Siding",
  "Roofing (steep slope)",
  "Roofing (low slope / EPDM / TPO)",
  "Gutters",
  "Soffit & fascia",
  "Trim / wraps",
  "Windows & doors",
  "Insulation",
  "Standing seam / metal",
  "Railings",
  "Decks",
  "Stucco / stone",
  "Service & warranty",
] as const;

const OPEN: Prisma.ProdLineWhereInput = { board: { in: ["ADD", "UPCOMING", "CURRENT", "WARRANTY"] } };
export const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);

export type PmScope = { scheduleName: string | null; builders: string[]; crews: string[] };

/** The user's PM assignments, or null when the office hasn't set any (they see everything). */
export async function pmScope(userId: string): Promise<PmScope | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { scheduleName: true, pmBuilders: true, pmCrews: true } });
  if (!u) return null;
  const s = { scheduleName: u.scheduleName?.trim() || null, builders: list(u.pmBuilders), crews: list(u.pmCrews) };
  return s.scheduleName || s.builders.length || s.crews.length ? s : null;
}

/** Schedule lines a PM runs: their name in the Super column, their builders, or their crews. */
export function mineWhere(s: PmScope): Prisma.ProdLineWhereInput {
  const or: Prisma.ProdLineWhereInput[] = [];
  if (s.scheduleName) or.push({ superName: { contains: s.scheduleName } });
  for (const b of s.builders) or.push({ builder: { contains: b } }, { project: { contains: b } });
  if (s.crews.length) or.push({ crew: { in: s.crews } });
  return or.length ? { OR: or } : { id: "-" };
}

/** Matches a scope's builders against an estimating-schedule row (customer column). */
export function mineEstimateWhere(s: PmScope, userName: string): Prisma.EstimateLogWhereInput {
  const first = userName.split(" ")[0];
  const or: Prisma.EstimateLogWhereInput[] = [{ estimator: { contains: first } }];
  for (const b of s.builders) or.push({ customer: { contains: b } });
  return { OR: or };
}

const top = <T extends string>(m: Map<T, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

/** Guesses from the schedule: for each Super name, the builders and crews they appear with; for each crew, the work types. */
export async function suggestions() {
  const rows = await prisma.prodLine.findMany({ where: OPEN, select: { superName: true, builder: true, project: true, market: true, crew: true, type: true } });
  const supers = new Map<string, { builders: Map<string, number>; crews: Map<string, number>; n: number }>();
  const crews = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const b = r.builder?.trim();
    if (r.superName) {
      const s = supers.get(r.superName) ?? { builders: new Map(), crews: new Map(), n: 0 };
      s.n++;
      if (b) s.builders.set(b, (s.builders.get(b) ?? 0) + 1);
      if (r.crew) s.crews.set(r.crew, (s.crews.get(r.crew) ?? 0) + 1);
      supers.set(r.superName, s);
    }
    if (r.crew && r.type) {
      const c = crews.get(r.crew) ?? new Map();
      for (const sc of scopesFromType(r.type)) c.set(sc, (c.get(sc) ?? 0) + 1);
      crews.set(r.crew, c);
    }
  }
  return {
    supers: [...supers.entries()].sort((a, b) => b[1].n - a[1].n).map(([name, s]) => ({ name, lines: s.n, builders: top(s.builders, 8).map(([k]) => k), crews: top(s.crews, 10).map(([k]) => k) })),
    crewScopes: new Map([...crews.entries()].map(([k, m]) => [k, top(m, 6).map(([s]) => s)])),
  };
}

/** Maps a schedule "Type" ("Siding Labor", "Gutters", "Roofing L&M", "Soffit/Fascia") to crew scopes. */
export function scopesFromType(type: string): string[] {
  const t = type.toLowerCase();
  const out: string[] = [];
  if (/sid|lap|shake|panel|hardie|lp\b|smart ?side|vinyl/.test(t)) out.push("Siding");
  if (/epdm|tpo|flat|low.?slope|membrane|mod ?bit/.test(t)) out.push("Roofing (low slope / EPDM / TPO)");
  else if (/roof|shingle/.test(t)) out.push("Roofing (steep slope)");
  if (/gutter|downspout/.test(t)) out.push("Gutters");
  if (/soffit|fascia/.test(t)) out.push("Soffit & fascia");
  if (/trim|wrap|column|post/.test(t)) out.push("Trim / wraps");
  if (/window|door/.test(t)) out.push("Windows & doors");
  if (/insul/.test(t)) out.push("Insulation");
  if (/standing|metal|seam/.test(t)) out.push("Standing seam / metal");
  if (/rail/.test(t)) out.push("Railings");
  if (/deck/.test(t)) out.push("Decks");
  if (/stucco|stone/.test(t)) out.push("Stucco / stone");
  if (/warrant|service|repair/.test(t)) out.push("Service & warranty");
  return out;
}

const clean = (v: string[]) => [...new Set(v.map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean))];

export async function savePm(userId: string, d: { scheduleName: string | null; builders: string[]; crews: string[] }) {
  await prisma.user.update({ where: { id: userId }, data: { scheduleName: d.scheduleName?.trim() || null, pmBuilders: clean(d.builders), pmCrews: clean(d.crews) } });
}

export async function saveCrewScopes(crewId: string, scopes: string[]) {
  const s = clean(scopes);
  await prisma.crew.update({ where: { id: crewId }, data: { scopes: s, trade: s.join(", ") || null } });
}

/** How much of "Who does what" is still blank (for the office desk reminder). */
export async function assignGaps() {
  const [pms, crews] = await Promise.all([
    prisma.user.count({ where: { role: { in: ["ADMIN", "ESTIMATOR"] }, scheduleName: null } }),
    prisma.crew.findMany({ where: { active: true }, select: { scopes: true } }),
  ]);
  return { pmsBlank: pms, crewsBlank: crews.filter((c) => !list(c.scopes).length).length };
}
