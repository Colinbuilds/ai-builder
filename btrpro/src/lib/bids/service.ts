// Public bids: reads the bid boards every morning, keeps each posting once, and lets estimators triage them
// (watch / pass / add to the estimating schedule). Sources are rows in BidSource; the built-ins below are the
// boards checked in October 2026 to be readable without a login. Members-only plan rooms (Omaha Builders
// Exchange, Lincoln Builders Bureau) are never read — their terms forbid it.
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { aiParse } from "@/lib/ai/claude";
import { getSettings, saveSettings } from "@/lib/settings";
import { addEntry } from "@/lib/estimating/schedule";
import { central, distance, parseCivic, parseIonWave, parseSdi, relevance, textOf, type Posting } from "./parse";

export class BidError extends Error {}
export const KINDS = { SDI: "SDI plan room", IONWAVE: "IonWave bid board", CIVIC: "CivicEngage bid page", PAGE: "Any page (BTRbot reads it)", SAM: "SAM.gov federal" } as const;
export type Kind = keyof typeof KINDS;
export const DEFAULT_RADIUS = 125; // straight-line miles ≈ 2 hours' drive on I-80 / US highways

export const BUILTIN: { name: string; kind: Kind; url: string; defaultCity?: string; defaultState?: string }[] = [
  { name: "Standard Digital Imaging — StandardSHARE plan room", kind: "SDI", url: "https://standarddigital.com/the-plan-room" },
  { name: "City of Omaha / Douglas County (IonWave)", kind: "IONWAVE", url: "https://douglascountypurchasing.ionwave.net/SourcingEvents.aspx?SourceType=1", defaultCity: "Omaha", defaultState: "NE" },
  { name: "City of Lincoln / Lancaster County (IonWave)", kind: "IONWAVE", url: "https://col.ionwave.net/SourcingEvents.aspx?SourceType=1", defaultCity: "Lincoln", defaultState: "NE" },
  { name: "Sarpy County (IonWave)", kind: "IONWAVE", url: "https://sarpy.ionwave.net/SourcingEvents.aspx?SourceType=1", defaultCity: "Papillion", defaultState: "NE" },
  { name: "Sarpy County bid postings", kind: "CIVIC", url: "https://www.sarpy.gov/Bids.aspx", defaultCity: "Papillion", defaultState: "NE" },
  { name: "City of Papillion", kind: "CIVIC", url: "https://www.papillion.org/Bids.aspx", defaultCity: "Papillion", defaultState: "NE" },
  { name: "City of La Vista", kind: "CIVIC", url: "https://www.cityoflavista.org/Bids.aspx", defaultCity: "La Vista", defaultState: "NE" },
  { name: "City of Bellevue", kind: "CIVIC", url: "https://www.bellevue.net/Bids.aspx", defaultCity: "Bellevue", defaultState: "NE" },
  { name: "City of Fremont", kind: "CIVIC", url: "https://www.fremontne.gov/Bids.aspx", defaultCity: "Fremont", defaultState: "NE" },
  { name: "City of Columbus", kind: "CIVIC", url: "https://www.columbusne.us/Bids.aspx", defaultCity: "Columbus", defaultState: "NE" },
  { name: "City of Grand Island", kind: "CIVIC", url: "https://www.grand-island.com/Bids.aspx", defaultCity: "Grand Island", defaultState: "NE" },
  { name: "Mills County, Iowa", kind: "CIVIC", url: "https://www.millscountyiowa.gov/Bids.aspx", defaultCity: "Glenwood", defaultState: "IA" },
  { name: "Omaha Public Schools purchasing", kind: "PAGE", url: "https://www.ops.org/departments/operations/purchasing-bids-rfp-rfq", defaultCity: "Omaha", defaultState: "NE" },
  { name: "State of Nebraska — agency bid opportunities", kind: "PAGE", url: "https://das.nebraska.gov/materiel/purchase_bureau/vendor/agency-rfp.html", defaultCity: "Lincoln", defaultState: "NE" },
  { name: "Pottawattamie County, Iowa", kind: "PAGE", url: "https://www.pottcounty-ia.gov/about/bid_notices", defaultCity: "Council Bluffs", defaultState: "IA" },
  { name: "SAM.gov — federal (Offutt, Guard, Corps of Engineers)", kind: "SAM", url: "https://sam.gov/search/?index=opp" },
];

export async function ensureSources() {
  const have = new Set((await prisma.bidSource.findMany({ select: { url: true } })).map((s) => s.url));
  for (const b of BUILTIN) if (!have.has(b.url)) await prisma.bidSource.create({ data: { ...b, builtIn: true } });
}

const UA = "Mozilla/5.0 (compatible; BTRpro/1.0; bid watcher for BTR Contracting, Omaha NE)";
export async function fetchPage(url: string) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/json" }, signal: AbortSignal.timeout(30_000), redirect: "follow" });
  const body = await res.text();
  if (/<title>\s*(Just a moment|Client Challenge|Attention Required|Access Denied)/i.test(body) || res.status === 403 || res.status === 429)
    throw new BidError("This site blocks automatic readers (bot check). Check it by hand, or sign up for its email alerts.");
  if (!res.ok) throw new BidError(res.status === 404 ? "The site answered 404 — the page moved, or the site turns away automatic readers. Check the link." : `The site answered ${res.status}.`);
  return body;
}

// ---------- BTRbot reads any bid page ----------
const PageBids = z.object({
  bids: z.array(
    z.object({
      title: z.string(),
      number: z.string().nullable(),
      agency: z.string().nullable(),
      city: z.string().nullable(),
      state: z.string().nullable().describe("2-letter state"),
      dueDate: z.string().nullable().describe("YYYY-MM-DD when bids/proposals are due"),
      dueTime: z.string().nullable().describe("HH:MM 24-hour Central, if given"),
      url: z.string().nullable().describe("link to the posting, absolute or as written"),
      summary: z.string().nullable(),
    }),
  ),
});

async function readPageWithAi(url: string, text: string, today: Date): Promise<Posting[]> {
  const { data } = await aiParse({
    task: [
      "TASK: list the open bid / RFP / RFQ / quote solicitations on this public purchasing page.",
      `Today is ${today.toISOString().slice(0, 10)}. Include only postings that are still open or have no stated close date; skip awarded, closed and cancelled ones and anything clearly in the past.`,
      "Copy titles and numbers exactly. Never invent a date, place or link — leave a field null when the page doesn't say. If the page lists no solicitations, return an empty list.",
    ].join("\n"),
    schema: PageBids,
    effort: "low",
    maxTokens: 8000,
    messages: [{ role: "user", content: `PAGE: ${url}\n\n${text.slice(0, 60_000)}` }],
  });
  return data.bids.map((b) => {
    const d = b.dueDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const t = b.dueTime?.match(/^(\d{1,2}):(\d{2})/);
    let link: string | null = null;
    try {
      link = b.url ? new URL(b.url, url).toString() : null;
    } catch {}
    return { title: b.title, number: b.number, agency: b.agency, city: b.city, state: b.state, dueAt: d ? central(+d[1], +d[2], +d[3], t ? +t[1] : 17, t ? +t[2] : 0) : null, url: link ?? url, summary: b.summary };
  });
}

// ---------- SAM.gov (federal) ----------
type SamOpp = { noticeId: string; title: string; solicitationNumber?: string; fullParentPathName?: string; postedDate?: string; responseDeadLine?: string | null; uiLink?: string; placeOfPerformance?: { city?: { name?: string }; state?: { code?: string } } };
export function mapSam(o: SamOpp): Posting {
  return {
    title: o.title,
    number: o.solicitationNumber ?? null,
    agency: o.fullParentPathName?.split(".").slice(-2).join(" · ") ?? null,
    city: o.placeOfPerformance?.city?.name ?? null,
    state: o.placeOfPerformance?.state?.code ?? null,
    dueAt: o.responseDeadLine ? new Date(o.responseDeadLine) : null,
    postedAt: o.postedDate ? new Date(`${o.postedDate.slice(0, 10)}T12:00:00Z`) : null,
    url: o.uiLink ?? `https://sam.gov/opp/${o.noticeId}/view`,
  };
}
const NAICS = ["238160", "238170", "236220"]; // roofing, siding, commercial building
async function readSam(now: Date): Promise<Posting[]> {
  const key = process.env.SAM_API_KEY;
  if (!key) throw new BidError("Add a free SAM.gov API key in Railway as SAM_API_KEY (sam.gov → your profile → Account Details → API Key).");
  const fmt = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
  const from = fmt(new Date(now.getTime() - 60 * 86_400_000));
  const out = new Map<string, Posting>();
  for (const state of ["NE", "IA"])
    for (const ncode of NAICS) {
      const u = `https://api.sam.gov/opportunities/v2/search?api_key=${encodeURIComponent(key)}&postedFrom=${from}&postedTo=${fmt(now)}&state=${state}&ncode=${ncode}&ptype=o,p,k&limit=200`;
      const res = await fetch(u, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new BidError(`SAM.gov answered ${res.status}${res.status === 403 ? " — check SAM_API_KEY" : ""}.`);
      const j = (await res.json()) as { opportunitiesData?: SamOpp[] };
      for (const o of j.opportunitiesData ?? []) out.set(o.noticeId, mapSam(o));
    }
  return [...out.values()];
}

// ---------- checking ----------
type Source = Awaited<ReturnType<typeof prisma.bidSource.findFirstOrThrow>>;

export async function readSource(src: Source, now = new Date()): Promise<{ postings: Posting[]; hash?: string; note?: string; unchanged?: boolean }> {
  if (src.kind === "SAM") return { postings: await readSam(now) };
  const html = await fetchPage(src.url);
  if (src.kind === "SDI") return { postings: parseSdi(html, src.url) };
  if (src.kind === "IONWAVE") {
    const r = parseIonWave(html, src.url);
    return { postings: r.postings, note: r.pages > 1 ? `The board has ${r.pages} pages; BTRpro reads the first (soonest to close). Open the board for the rest.` : undefined };
  }
  if (src.kind === "CIVIC") {
    if (!/bidItems/.test(html)) throw new BidError("This page doesn't look like a CivicEngage bid page anymore. Check the link.");
    return { postings: parseCivic(html, src.url) };
  }
  const text = textOf(html);
  const hash = createHash("sha256").update(text).digest("hex");
  if (hash === src.contentHash) return { postings: [], hash, unchanged: true };
  return { postings: await readPageWithAi(src.url, text, now), hash };
}

/** Saves one source's postings: new ones land as NEW; ones no longer listed are marked gone. */
export async function savePostings(src: Source, postings: Posting[], now = new Date()) {
  const seen: string[] = [];
  let added = 0;
  for (const p of postings) {
    const title = p.title.replace(/\s+/g, " ").trim();
    if (!title) continue;
    // addenda change the number ("CI-2026-0114 Addendum 3") but not the bid
    const ident = p.number?.replace(/\s+addendum.*$/i, "").trim() || (p.url && p.url !== src.url ? p.url : null) || title.toLowerCase();
    const key = `${src.id}:${ident}`.slice(0, 500);
    seen.push(key);
    const city = p.city || src.defaultCity;
    const state = p.state || (p.city ? null : src.defaultState);
    const d = distance(city, state);
    const data = { title, number: p.number ?? null, agency: p.agency ?? null, city: city ?? null, state: state ?? null, dueAt: p.dueAt ?? null, postedAt: p.postedAt ?? null, url: p.url ?? src.url, summary: p.summary?.slice(0, 1000) ?? null, miles: d?.miles ?? null, nearest: d?.nearest ?? null, relevance: relevance(title, p.summary), lastSeenAt: now, gone: false };
    const had = await prisma.publicBid.findUnique({ where: { key }, select: { id: true } });
    if (had) await prisma.publicBid.update({ where: { key }, data });
    else {
      await prisma.publicBid.create({ data: { ...data, key, sourceId: src.id, firstSeenAt: now } });
      added++;
    }
  }
  await prisma.publicBid.updateMany({ where: { sourceId: src.id, gone: false, key: { notIn: seen } }, data: { gone: true } });
  return added;
}

export async function checkSource(id: string, now = new Date()) {
  const src = await prisma.bidSource.findUniqueOrThrow({ where: { id } });
  try {
    const r = await readSource(src, now);
    const added = r.unchanged ? 0 : await savePostings(src, r.postings, now);
    if (r.unchanged) await prisma.publicBid.updateMany({ where: { sourceId: src.id, gone: false }, data: { lastSeenAt: now } });
    await prisma.bidSource.update({ where: { id }, data: { lastCheckedAt: now, lastOkAt: now, lastError: r.note ?? null, lastCount: r.unchanged ? src.lastCount : r.postings.length, contentHash: r.hash ?? src.contentHash } });
    return { ok: true as const, added, count: r.unchanged ? (src.lastCount ?? 0) : r.postings.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.bidSource.update({ where: { id }, data: { lastCheckedAt: now, lastError: msg.slice(0, 400) } });
    return { ok: false as const, error: msg, added: 0, count: 0 };
  }
}

let running = false;
export async function checkAll(now = new Date()) {
  if (running) return null;
  running = true;
  try {
    await ensureSources();
    const sources = await prisma.bidSource.findMany({ where: { enabled: true }, orderBy: { createdAt: "asc" } });
    let added = 0;
    let failed = 0;
    for (const s of sources) {
      const r = await checkSource(s.id, now);
      added += r.added;
      if (!r.ok) failed++;
    }
    await saveSettings({ bidsCheckedAt: now.toISOString() }, { id: "", name: "Bid watcher" });
    return { sources: sources.length, added, failed };
  } finally {
    running = false;
  }
}

/** Once a day, first check after 5 AM Central. */
export function dueForCheck(lastIso: string | null, now = new Date()) {
  const fiveAm = central(...(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(now).split("-").map(Number) as [number, number, number]), 5, 0);
  if (now < fiveAm) return false;
  return !lastIso || new Date(lastIso) < fiveAm;
}

let watching = false;
export function startBidWatcher(everyMs = 30 * 60_000) {
  if (watching) return;
  watching = true;
  const run = async () => {
    try {
      const s = await getSettings();
      if (!dueForCheck(s.bidsCheckedAt)) return;
      const r = await checkAll();
      if (r) console.log(`[bids] ${r.sources} boards, ${r.added} new postings, ${r.failed} couldn't be read`);
    } catch (e) {
      console.error("[bids] check failed:", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(run, 150_000);
  setInterval(run, everyMs);
}

// ---------- triage ----------
const RELEVANT = ["ROOFING", "EXTERIOR", "BUILDING"];
export async function radius() {
  return (await getSettings()).bidRadiusMiles ?? DEFAULT_RADIUS;
}
const inRange = (r: number) => ({ OR: [{ miles: null }, { miles: { lte: r } }] });

/** Untriaged postings worth a look (in range, still open, roofing / exterior / building). */
export async function newBidCount(now = new Date()) {
  return prisma.publicBid.count({ where: { status: "NEW", gone: false, relevance: { in: RELEVANT }, ...inRange(await radius()), OR: [{ dueAt: null }, { dueAt: { gte: now } }] } });
}

export async function decideBid(id: string, status: "WATCH" | "PASS" | "NEW", actor: { name: string }) {
  return prisma.publicBid.update({ where: { id }, data: { status, decidedBy: status === "NEW" ? null : actor.name, decidedAt: status === "NEW" ? null : new Date() } });
}

/** Puts the posting on the commercial estimating schedule (Current) and links them. */
export async function addBidToSchedule(id: string, actor: { id: string; name: string }) {
  const b = await prisma.publicBid.findUniqueOrThrow({ where: { id }, include: { source: true } });
  if (b.estimateLogId) return b.estimateLogId;
  const e = await addEntry(
    {
      board: "CURRENT",
      market: "COMMERCIAL",
      customer: b.agency ?? b.source.name.replace(/\s*\(.*\)$/, ""),
      project: [b.title, b.city && b.state ? `(${b.city}, ${b.state})` : null].filter(Boolean).join(" "),
      scope: b.relevance === "ROOFING" ? "Roofing" : b.relevance === "EXTERIOR" ? "Siding / exterior" : null,
      dueAt: b.dueAt,
      bidDate: b.dueAt,
      receivedAt: new Date(),
      notes: [`Public bid from ${b.source.name}${b.number ? ` · #${b.number}` : ""}`, b.url].filter(Boolean).join("\n"),
      folderLink: b.url,
    },
    actor,
  );
  await prisma.publicBid.update({ where: { id }, data: { status: "ADDED", estimateLogId: e.id, decidedBy: actor.name, decidedAt: new Date() } });
  return e.id;
}

export async function addSource(x: { name: string; kind: string; url: string; defaultCity: string | null; defaultState: string | null }, actor: { name: string }) {
  if (!(x.kind in KINDS)) throw new BidError("Pick what kind of board it is.");
  if (!x.name.trim()) throw new BidError("Name the board (e.g. City of Blair).");
  try {
    const u = new URL(x.url);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch {
    throw new BidError("Paste the full web address of the bid page.");
  }
  if (/buildersbureau\.com|omahaplanroom\.com/i.test(x.url)) throw new BidError("That plan room is members-only; its terms don't allow automatic reading.");
  return prisma.bidSource.create({ data: { name: x.name.trim(), kind: x.kind, url: x.url.trim(), defaultCity: x.defaultCity?.trim() || null, defaultState: x.defaultState?.trim().toUpperCase().slice(0, 2) || null, createdBy: actor.name } });
}
