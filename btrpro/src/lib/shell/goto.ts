// "What do you need to do?" — someone types it the way they'd say it ("schedule a model for DR KC next week",
// "invoice 1234 maple", "scan a receipt") and gets back a few tagged buttons that land them on the right screen,
// already pointed at the builder / model / job / date. Plain matching first (instant, no AI cost); the AI is only
// asked to pick from the same list of screens when nothing matched.
import { z } from "zod";
import { prisma } from "@/lib/db";
import { aiConfigured, aiParse } from "@/lib/ai/claude";

export type Hit = { tag: string; label: string; href: string; note?: string };
type Who = { id: string; role: string };

const STOP = new Set("a an the for to of on in at and or i we need want have get go do make add put new next this that my our it is be please can you with from up some".split(" "));
const GENERIC = new Set("homes home builders builder building construction contracting company companies inc llc co corp group custom development properties residential communities".split(" "));
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
const initials = (s: string) => words(s).map((w) => w[0]).join("");

// ---------- when ----------
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** "today", "tomorrow", "next week" (its Monday), "monday", "10/14" → YYYY-MM-DD in Central time. */
export function whenFrom(q: string, now = new Date()): { date: string; said: string } | null {
  const t = q.toLowerCase();
  const local = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const base = new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(), 12));
  const plus = (n: number) => new Date(base.getTime() + n * 86_400_000);
  if (/\btoday\b/.test(t)) return { date: iso(base), said: "today" };
  if (/\btomorrow\b/.test(t)) return { date: iso(plus(1)), said: "tomorrow" };
  if (/\bnext week\b/.test(t)) return { date: iso(plus(((8 - base.getUTCDay()) % 7) || 7)), said: "next week (Monday)" };
  if (/\bthis week\b/.test(t)) return { date: iso(base), said: "this week" };
  // m/d only when it reads as a date: a real month/day, not a size ("3/4 plywood", "1/2 inch"), and with a
  // year or a scheduling word nearby
  const md = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b(?!\s*(?:"|in\b|inch|ply|plywood|osb|sheet|board|x\b))/);
  const datey = md && Number(md[1]) >= 1 && Number(md[1]) <= 12 && Number(md[2]) >= 1 && Number(md[2]) <= 31 && (!!md[3] || /\b(on|for|by|start\w*|due|schedul\w*|week of|date)\s+(\w+\s+)?$/.test(t.slice(0, md.index)) || /\b(on|for|by|start\w*|due|schedul\w*)\b/.test(t));
  if (md && datey) {
    const y = md[3] ? (md[3].length === 2 ? 2000 + Number(md[3]) : Number(md[3])) : base.getUTCFullYear();
    const d = new Date(Date.UTC(y, Number(md[1]) - 1, Number(md[2]), 12));
    if (!md[3] && d < plus(-30)) d.setUTCFullYear(y + 1);
    return { date: iso(d), said: `${md[1]}/${md[2]}` };
  }
  const day = DAYS.findIndex((n) => new RegExp(`\\b${n}\\b`).test(t));
  if (day >= 0) return { date: iso(plus(((day - base.getUTCDay() + 7) % 7) || 7)), said: DAYS[day] };
  return null;
}

// ---------- what ----------
const INTENTS: { key: string; re: RegExp }[] = [
  { key: "house", re: /\b(schedul\w*|model|house|lot|start\w*|plan book|elevation|spec)\b/ },
  { key: "invoice", re: /\b(invoic\w*|bill(ing)?|charge|draw|pay app)\b/ },
  { key: "paid", re: /\b(paid|payment|collect\w*|check came|deposit)\b/ },
  { key: "receipt", re: /\b(receipt|ticket|scan)\b/ },
  { key: "order", re: /\b(order\w*|material\w*|deliver\w*|abc)\b/ },
  { key: "estimate", re: /\b(estimat\w*|bid\w*|quote|takeoff|measur\w*|eagleview)\b/ },
  { key: "lead", re: /\b(lead|new (job|customer)|homeowner|inspection)\b/ },
  { key: "profit", re: /\b(profit|margin|audit|money|making|losing)\b/ },
  { key: "price", re: /\b(price\w*|pricing|sell|cost of)\b/ },
  { key: "crew", re: /\b(crew|payout|sub(contractor)?s?|pay the)\b/ },
  { key: "photo", re: /\b(photo\w*|picture\w*|pics?)\b/ },
  { key: "task", re: /\b(task|remind\w*|to ?do|follow up)\b/ },
];

export async function goto(q: string, who: Who, now = new Date()): Promise<{ hits: Hit[]; when: ReturnType<typeof whenFrom>; by: "MATCH" | "AI" | "NONE" }> {
  const text = q.trim().slice(0, 300);
  if (!text) return { hits: [], when: null, by: "NONE" };
  const lower = ` ${words(text).join(" ")} `;
  const toks = words(text).filter((w) => !STOP.has(w));
  const when = whenFrom(text, now);
  const intents = new Set(INTENTS.filter((i) => i.re.test(lower)).map((i) => i.key));
  const hits: Hit[] = [];
  const add = (h: Hit) => !hits.some((x) => x.href === h.href) && hits.push(h);
  const whenQs = when ? `&when=${when.date}` : "";

  // builders, their plan books (KC = Kansas City) and models, by name, initials or code
  const builders = await prisma.company.findMany({ where: { type: "BUILDER" }, select: { id: true, name: true, planBooks: { where: { active: true }, select: { id: true, label: true, data: true } } } });
  // "DR Horton" answers to "dr horton", "horton", "dr", "drh", "drhorton"
  let bHits = builders.filter((b) => {
    const w = words(b.name).filter((x) => x.length > 1 && !STOP.has(x));
    if (!w.length) return false;
    // a single word only counts when it's distinctive: not "homes", and not a word people use for what to do ("receipt")
    const own = (x: string) => !GENERIC.has(x) && !INTENTS.some((i) => i.re.test(` ${x} `));
    const names = new Set([w.join(""), initials(b.name), w[0] + w.slice(1).map((x) => x[0]).join(""), ...(w[0].length >= 2 && own(w[0]) ? [w[0]] : []), ...w.filter((x) => x.length >= 4 && own(x))]);
    return lower.includes(` ${w.join(" ")} `) || toks.some((t) => t.length >= 2 && names.has(t));
  });
  // several accounts can answer to "DR" (Omaha / Kansas City / plain): keep the ones whose market or plan book was
  // named ("KC", "kansas city"), else the ones with a plan book
  const market = (b: (typeof builders)[number]) => {
    const tags = [b.name.match(/\(([^)]*)\)/)?.[1] ?? "", ...b.planBooks.map((pb) => pb.label)].filter(Boolean);
    return tags.some((t) => lower.includes(` ${words(t).join(" ")} `) || (initials(t).length >= 2 && toks.includes(initials(t))));
  };
  const fullName = (b: (typeof builders)[number]) => lower.includes(` ${words(b.name.replace(/\([^)]*\)/g, " ")).join(" ")} `);
  const rank = (b: (typeof builders)[number]) => (fullName(b) ? 4 : 0) + (market(b) ? 2 : 0) + (b.planBooks.length ? 1 : 0);
  // choose only among accounts of the same builder; two different builders named in one request both stay
  const coreName = (b: (typeof builders)[number]) => words(b.name.replace(/\([^)]*\)/g, " ")).join(" ");
  bHits = bHits.filter((b) => rank(b) === Math.max(...bHits.filter((x) => coreName(x) === coreName(b)).map(rank)));
  for (const b of bHits) {
    const books = b.planBooks.filter((pb) => lower.includes(` ${words(pb.label).join(" ")} `) || toks.includes(initials(pb.label)) || toks.some((t) => words(pb.label).includes(t)));
    const book = books[0] ?? (b.planBooks.length === 1 ? b.planBooks[0] : null);
    const plans = (book?.data as { plans?: { name: string }[] } | null)?.plans ?? [];
    const model = plans.find((p) => words(p.name).some((w) => (w.length >= 4 || /\d/.test(w)) && toks.includes(w)));
    if (model && book) add({ tag: `${b.name} · ${book.label} · ${model.name}`, label: when ? `Add a ${model.name} — starting ${when.said}` : `Open ${model.name}`, href: `/builders/${b.id}/plans/${encodeURIComponent(model.name)}?book=${book.id}&t=${intents.has("house") || when ? "schedule" : "takeoff"}${whenQs}` });
    if (book) add({ tag: `${b.name} · ${book.label} models`, label: intents.has("house") || when ? "Pick the model to schedule" : `${book.label} models`, href: `/builders/${b.id}/plans?go=1${whenQs}#book-${book.id}` });
    else add({ tag: `${b.name}`, label: `${b.name} — plans & models`, href: `/builders/${b.id}/plans` });
    if (intents.has("house")) add({ tag: "Builder's PDF", label: "Have the builder's option sheet? Drop it in", href: "/builders/add-house" });
    if (intents.has("profit") && book) add({ tag: `${b.name} · ${book.label}`, label: "Profit audit", href: `/builders/${b.id}/plans/audit` });
    if (intents.has("price") && !model) add({ tag: `${b.name}`, label: "Pricing", href: `/builders/${b.id}?tab=pricing` });
  }

  // a job by its name or address ("1234 maple", "smith reroof")
  // job search words: not the date ("10", "14", "week", "monday"), not action words, not the builder's name
  const dateWords = new Set(["today", "tomorrow", "week", "weeks", "next", "this", "month", ...DAYS, ...(when ? (text.match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/)?.[0].split("/") ?? []) : [])]);
  const keys = toks.filter((t) => !dateWords.has(t) && (/^\d{2,6}$/.test(t) || (t.length >= 4 && !INTENTS.some((i) => i.re.test(` ${t} `)) && !bHits.some((b) => words(b.name).includes(t)))));
  if (keys.length) {
    const cands = await prisma.project.findMany({
      where: { status: { notIn: ["LOST"] }, OR: keys.slice(0, 4).flatMap((k) => [{ name: { contains: k } }, { address: { contains: k } }]) },
      select: { id: true, name: true, address: true, builderHouse: true },
      orderBy: { updatedAt: "desc" },
      take: 40,
    });
    const score = (p: { name: string; address: string | null }) => keys.filter((k) => `${p.name} ${p.address ?? ""}`.toLowerCase().includes(k)).length;
    const best = cands.map((p) => ({ p, s: score(p) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    const top = best.filter((x) => x.s === best[0]?.s).slice(0, 3);
    for (const { p } of top) {
      const b = `/projects/${p.id}`;
      const name = p.name.length > 60 ? `${p.name.slice(0, 57)}…` : p.name;
      if (intents.has("invoice")) add({ tag: name, label: "Invoice it", href: p.builderHouse ? `${b}/house?t=invoice` : `${b}/billing` });
      else if (intents.has("paid")) add({ tag: name, label: "Record the payment", href: `${b}/billing` });
      else if (intents.has("profit")) add({ tag: name, label: "Profit", href: p.builderHouse ? `${b}/house?t=profit` : `${b}/costs` });
      else if (intents.has("order")) add({ tag: name, label: "Order materials", href: `${b}/orders` });
      else if (intents.has("estimate")) add({ tag: name, label: "Estimates", href: `${b}/estimates` });
      else if (intents.has("photo")) add({ tag: name, label: "Photos", href: `${b}/photos` });
      else if (intents.has("house") || when) add({ tag: name, label: "Schedule & crews", href: `${b}/production` });
      else add({ tag: name, label: "Open the job", href: b });
    }
  }

  // plain "what do I do" requests with no builder or job in them
  const staff = who.role !== "VIEWER";
  if (intents.has("receipt") && staff) add({ tag: "Receipts", label: "Scan a receipt", href: "/receipts" });
  if (intents.has("house") && !bHits.length && staff) add({ tag: "Builder house", label: "Add a builder house", href: "/builders/add-house" });
  if (intents.has("lead") && staff) add({ tag: "New job", label: "New job or lead", href: "/projects/new" });
  if (intents.has("estimate") && !hits.some((h) => h.label === "Estimates")) add({ tag: "Estimating", label: "Estimating schedule", href: "/estimating/schedule" });
  if (intents.has("order") && !hits.some((h) => h.label === "Order materials")) add({ tag: "Orders", label: "Material orders & deliveries", href: "/deliveries" });
  if (intents.has("crew")) add({ tag: "Crews", label: "Crews & subs", href: "/crews" });
  if (intents.has("crew") && staff) add({ tag: "Crews", label: "Crew invoices (payouts)", href: "/crews/invoices" });
  if (intents.has("task")) add({ tag: "My day", label: "My tasks", href: "/today" });
  if (intents.has("invoice") && !hits.some((h) => h.label === "Invoice it")) add({ tag: "Billing", label: "Pick the job to invoice", href: "/jobs" });
  if ((intents.has("house") || when) && !hits.some((h) => h.href.startsWith("/production"))) add({ tag: "Schedule", label: "Production schedule", href: "/production" });

  if (/\bhow (do|can|should) (i|we)\b|\bhelp\b/.test(lower)) add({ tag: "Help", label: "How do I…? step-by-step guides", href: "/help" });
  if (hits.length) return { hits: hits.slice(0, 6), when, by: "MATCH" };
  if (!aiConfigured()) return { hits: [], when, by: "NONE" };
  return { hits: await aiPick(text, builders.map((b) => ({ id: b.id, name: b.name }))), when, by: "AI" };
}

// ---------- AI fallback: choose from known screens, never invent a link ----------
const SCREENS: [string, string][] = [
  ["/builders/add-house", "Add a builder house (from the builder's PDF or by picking the model)"],
  ["/projects/new", "New job or lead"],
  ["/receipts", "Scan a receipt"],
  ["/production", "Production schedule"],
  ["/estimating/schedule", "Estimating schedule"],
  ["/jobs", "Find a job"],
  ["/today", "My tasks"],
  ["/deliveries", "Material orders & deliveries"],
  ["/crews", "Crews & subs"],
  ["/crews/invoices", "Crew invoices / payouts"],
  ["/bills", "Supplier bills"],
  ["/takeoff", "Blueprint measurer"],
  ["/bids", "Public bids"],
  ["/reports/ar", "Money owed to us (A/R)"],
  ["/overview", "Company overview"],
  ["/help", "How do I…? step-by-step guides"],
  ["/builders", "Builders and their pricing"],
];
async function aiPick(text: string, builders: { id: string; name: string }[]): Promise<Hit[]> {
  const all = [...SCREENS, ...builders.map((b) => [`/builders/${b.id}/plans`, `${b.name}: plans & models`] as [string, string])];
  try {
    const { data } = await aiParse({
      task: "Someone at a roofing company typed what they need to do. Pick up to 3 screens from the list that get them there, best first. Only use links from the list.",
      schema: z.object({ picks: z.array(z.object({ href: z.string(), why: z.string().describe("a few words") })) }),
      effort: "low",
      maxTokens: 1000,
      messages: [{ role: "user", content: `They typed: "${text}"\n\nScreens:\n${all.map(([h, l]) => `${h} — ${l}`).join("\n")}` }],
    });
    const ok = new Map(all);
    return data.picks.filter((p) => ok.has(p.href)).slice(0, 3).map((p) => ({ tag: "Suggested", label: ok.get(p.href)!, href: p.href, note: p.why }));
  } catch {
    return [];
  }
}
