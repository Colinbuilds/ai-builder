// Builder start sheets: the PDF a track builder sends when a house is going (DR Horton's "Selected Option Summary").
// It's read into lot / address / plan / elevation / garage / basement / porch, matched to the builder's plan book,
// and becomes a job + schedule line with one click. DR Horton's layout is read directly; other builders' PDFs go to
// the AI. Nothing is guessed: what the sheet doesn't say, or says in a way we can't map for sure, is flagged.
import { z } from "zod";
import { prisma } from "@/lib/db";
import { saveUpload } from "@/lib/storage";
import { pdfToText } from "@/lib/sheets/extract";
import { aiParse } from "@/lib/ai/claude";
import { matchAccount } from "@/lib/import/schedule";
import { activeBooks } from "./planbook";
import type { Plan, PlanBookData, Selection } from "./plans";

export class StartError extends Error {}
type Actor = { id: string; name: string; role: string };

export type StartOption = { code: string | null; description: string; action: string | null; note: string | null };
export type StartData = {
  builder: string | null;
  sheetDate: string | null;
  revision: string | null;
  subdivision: string | null;
  lot: string | null;
  address: string | null;
  city: string | null;
  permit: string | null;
  planCode: string | null; // "X450"
  elevationCode: string | null; // "A2"
  swing: string | null; // "L" / "R"
  options: StartOption[];
};

const clean = (s: string | undefined | null) => (s ?? "").replace(/\s+/g, " ").trim() || null;
const title = (s: string | null) => (s ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\b(Mo|Ks|Ne|Ia)\b/g, (m) => m.toUpperCase()) : null);

export const looksLikeStartSheet = (text: string) => /Plan\/Elevation\/Swing:|Selected Option Summary/i.test(text);

/** DR Horton's "Selected Option Summary" layout (as BTRpro's PDF reader lays it out). */
export function parseStartText(text: string): StartData | null {
  const m = (re: RegExp) => clean(text.match(re)?.[1]);
  const pes = text.match(/Plan\/Elevation\/Swing:\s*([\w-]+)\s*\/\s*([\w-]+)\s*\/\s*([A-Z]+)?/i);
  if (!pes) return null;
  const options: StartOption[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const o = lines[i].match(/^(?:u\s+)?(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(ADD|Same|CHG|DEL\w*)\s+([A-Z0-9]{5,})\s+(.+?)\s+(\d+)\s+(\d{3})\s*$/i);
    if (!o) continue;
    const note: string[] = [];
    for (let j = i + 1; j < lines.length && !/^\.{10,}/.test(lines[j]) && !/^(?:u\s+)?\d{1,2}\/\d{1,2}\/\d{2,4}\s+(ADD|Same|CHG|DEL)/i.test(lines[j]); j++) note.push(lines[j].replace(/^Note:\s*/i, "").trim());
    options.push({ code: o[3], description: clean(o[4])!, action: o[2].toUpperCase(), note: clean(note.join(" ")) });
  }
  return {
    builder: clean(text.match(/^(.+?)\s+Date - /m)?.[1]?.replace(/^Selected Option Summary\s*/i, "")),
    sheetDate: m(/Date -[ .]*(\d{1,2}\/\d{1,2}\/\d{2,4})/),
    revision: m(/Revision #\s*(\d+)/),
    subdivision: m(/Subdivision Name:\s*(.+)/),
    lot: m(/Lot\/Block\/Phase:\s*([A-Z0-9-]+)/i),
    address: title(m(/Lot Address:\s*(.+?)(?:\s+Milestone|\s+Permit|$)/m)),
    city: title(clean(m(/Lot City, St Zip:\s*(.+)/)?.replace(/\s+,/g, ","))),
    permit: m(/Permit Number:\s*(\S+)/),
    planCode: clean(pes[1]),
    elevationCode: clean(pes[2]),
    swing: clean(pes[3]),
    options,
  };
}

const AiStart = z.object({
  builder: z.string().nullable(),
  sheetDate: z.string().nullable(),
  revision: z.string().nullable(),
  subdivision: z.string().nullable(),
  lot: z.string().nullable().describe("Lot number as printed"),
  address: z.string().nullable().describe("House / lot street address as printed (not the builder's office)"),
  city: z.string().nullable().describe("City, state zip of the lot"),
  permit: z.string().nullable(),
  planCode: z.string().nullable().describe("Plan / model name or code as printed, e.g. X450 or Bristol"),
  elevationCode: z.string().nullable().describe("Elevation as printed, e.g. A, B2, C3"),
  swing: z.string().nullable().describe("Garage swing / handing as printed: L, R, LH, RH"),
  options: z.array(z.object({ code: z.string().nullable(), description: z.string(), action: z.string().nullable(), note: z.string().nullable() })).describe("Every selected option, exactly as printed"),
});

/** A start sheet's elevation code + options → the plan-book pick, with anything uncertain flagged. */
export function startSelection(d: StartData, plan: Plan | null) {
  const flags: string[] = [];
  const elevs = plan ? [...new Set([...plan.roofing, ...plan.gutters].filter((o) => o.kind === "ELEVATION").map((o) => o.label))] : [];
  const code = (d.elevationCode ?? "").toUpperCase();
  const letter = code.match(/^[A-Z]/)?.[0] ?? null;
  const digit = code.match(/(\d)/)?.[1] ?? null;
  let elevation = letter && elevs.includes(letter) ? letter : null;
  if (!elevation) flags.push(code ? `Elevation “${d.elevationCode}” isn't in the plan book for this model — pick it.` : "The sheet doesn't show the elevation — pick it.");
  if (!elevation) elevation = elevs[0] ?? "";
  const opt = (re: RegExp) => d.options.find((o) => re.test(o.description));
  const threeCar = digit === "3" || !!opt(/\b3[- ]?CAR\b/i);
  if (!digit && !opt(/\b[23][- ]?CAR\b/i)) flags.push("Garage size isn't printed — check 2 or 3 car.");
  const bsmt = d.options.find((o) => /BASEMENT|BSMNT|BSMT/i.test(o.description) && !/DECK|PATIO|PORCH/i.test(o.description));
  let basement: Selection["basement"] = "STANDARD";
  if (bsmt && /WALK-?\s?OUT|DAY-?\s?LIGHT/i.test(bsmt.description)) basement = "DLWO";
  else if (bsmt && /LOOK-?\s?OUT/i.test(bsmt.description)) flags.push("Look-out basement — confirm whether it takes the daylight / walkout gutter add.");
  else if (!bsmt) flags.push("No basement option on the sheet — priced as standard.");
  const porch = !!opt(/(COVERED|REAR)\s+(REAR\s+)?PORCH|PORCH\s+(ROOF|COVER)/i);
  const deck = opt(/\bDECK\b/i);
  if (deck) flags.push(`Deck: ${deck.description.toLowerCase()} — not roofing, noted for the crew.`);
  const exterior = opt(/EXTERIOR PACKAGE|EXTERIOR COLOR/i);
  const color = exterior ? clean([exterior.description.replace(/^EXTERIOR PACKAGE\s*/i, "Pkg "), exterior.note].filter(Boolean).join(": ")) : null;
  const sel: Selection = { elevation, garage: threeCar ? "3" : "2", basement, porch };
  return { sel, flags, color };
}

/** Which builder, plan book and model a start sheet is for. */
export async function matchStart(d: StartData) {
  const builders = await prisma.company.findMany({ where: { type: "BUILDER" }, select: { id: true, name: true, type: true } });
  // "D.R. HORTON - KANSAS CITY" → try as printed, without periods, then just the name before the market
  const tries = d.builder ? [d.builder, d.builder.replace(/\./g, ""), d.builder.replace(/\./g, "").split(/\s+-\s+/)[0]] : [];
  let company = tries.map((t) => matchAccount(t, builders).account).find(Boolean) ?? null;
  let books = company ? await activeBooks(company.id) : [];
  // the same builder can have several accounts ("DR Horton", "DR Horton (Kansas City)", "DR Horton (Omaha)"):
  // when the matched one has no plan book, use the same-name account that does — the market on the sheet decides
  if (company && !books.length) {
    const core = (n: string) => n.replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
    const same = builders.filter((b) => b.id !== company!.id && core(b.name) === core(company!.name));
    const withBooks = (await Promise.all(same.map(async (b) => ({ b, books: await activeBooks(b.id) })))).filter((x) => x.books.length);
    const text = (d.builder ?? "").toLowerCase();
    const pick = withBooks.find((x) => x.books.some((bk) => text.includes(bk.label.toLowerCase())) || text.includes((x.b.name.match(/\(([^)]*)\)/)?.[1] ?? "~~").toLowerCase())) ?? (withBooks.length === 1 ? withBooks[0] : null);
    if (pick) ({ b: company, books } = { b: { ...pick.b }, books: pick.books });
  }
  // a builder with books in several markets: the one named on the sheet ("D.R. HORTON - KANSAS CITY")
  const book = books.find((b) => d.builder && new RegExp(`\\b${b.label.replace(/[^\w ]/g, "")}\\b`, "i").test(d.builder)) ?? books[0] ?? null;
  const plan = book ? findStartPlan(book.data, d.planCode) : null;
  return { company, book, plan };
}

/** "X450" → "X450 Newcastle"; "Bristol" → "Bristol". */
export function findStartPlan(data: PlanBookData, code: string | null) {
  if (!code) return null;
  const c = code.toLowerCase().replace(/[^a-z0-9]/g, "");
  return data.plans.find((p) => p.name.toLowerCase().replace(/[^a-z0-9]/g, "").startsWith(c)) ?? data.plans.find((p) => p.name.toLowerCase().split(/\s+/).some((w) => w.replace(/[^a-z0-9]/g, "") === c)) ?? null;
}

/** Save and read one start-sheet PDF. The same sheet (same builder, lot, plan and revision) isn't added twice. */
export async function readStartSheet(file: { bytes: Uint8Array; name: string }, actor: Actor, text?: string) {
  if (actor.role === "VIEWER") throw new StartError("Viewers can't add houses.");
  if (!file.bytes.length) throw new StartError("Choose the builder's PDF.");
  if (file.bytes.length > 25 * 1024 * 1024) throw new StartError(`${file.name} is over 25 MB.`);
  const isPdf = file.bytes[0] === 0x25 && file.bytes[1] === 0x50 && file.bytes[2] === 0x44 && file.bytes[3] === 0x46;
  if (!isPdf) throw new StartError(`${file.name} isn't a PDF.`);
  const t = text ?? (await pdfToText(file.bytes).catch(() => ""));
  let data = parseStartText(t);
  let readBy = "PARSER";
  if (!data) {
    readBy = "AI";
    const { data: ai } = await aiParse({
      task: "Read a home builder's start / option sheet (the paperwork saying a house is going): which lot, address, plan, elevation, garage swing and options. Copy only what is printed; null when it isn't.",
      schema: AiStart,
      effort: "low",
      messages: [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(file.bytes).toString("base64") } }, { type: "text", text: "Read this start sheet." }] }],
    });
    data = ai;
  }
  if (!data.planCode && !data.address) throw new StartError(`Couldn't find a plan or an address in ${file.name}. Is it the builder's option / start sheet?`);
  const { company } = await matchStart(data);
  const key = [company?.id ?? data.builder, data.lot ?? data.address, data.planCode, data.elevationCode, data.revision].map((x) => (x ?? "").toString().toLowerCase()).join("|");
  const dupe = await prisma.builderStart.findFirst({ where: { dedupeKey: key, status: { not: "DISMISSED" } } });
  if (dupe) return { start: dupe, duplicate: true };
  const fileUrl = await saveUpload(file.bytes, file.name || "start.pdf", "builder-starts");
  const start = await prisma.builderStart.create({ data: { companyId: company?.id ?? null, fileUrl, fileName: file.name || "start.pdf", data: data as never, readBy, dedupeKey: key, createdBy: actor.name } });
  return { start, duplicate: false };
}

/** Everything a start needs on screen: what was read, the match, the pick, the flags. */
export async function startView(id: string) {
  const s = await prisma.builderStart.findUnique({ where: { id } });
  if (!s) return null;
  const d = s.data as unknown as StartData;
  const { company, book, plan } = await matchStart(d);
  const { sel, flags, color } = startSelection(d, plan);
  if (!company) flags.unshift(`Builder “${d.builder ?? "?"}” isn't set up as a builder in BTRpro.`);
  else if (!book) flags.unshift(`${company.name} has no plan book loaded — import it on the builder's Plans & models tab.`);
  else if (!plan) flags.unshift(`Plan “${d.planCode ?? "?"}” isn't in the ${book.label} plan book — pick the model.`);
  return { start: s, data: d, company, book, plan, sel, flags, color };
}

export async function dismissStart(id: string) {
  await prisma.builderStart.update({ where: { id }, data: { status: "DISMISSED" } });
}
