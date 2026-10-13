// Builder job packets: drop a house's work orders and plan set on Create job and the form fills in for review.
// - Hubbell ("The Home Company") ToolKit work orders are text PDFs in a fixed layout, read here line by line:
//   one work order per scope, with its number, total (our sell), options and the house's model / elevation / address.
// - The plan set's cover sheet carries the selections (elevation type, basement type, deck/patio); the AI reads
//   that one page's text.
// - Any other builder's work order goes to the AI whole.
// Only what's printed is read. A basement nothing states is Full Dig, the base house.
import { z } from "zod";
import { aiErrorMessage, aiParse } from "@/lib/ai/claude";
import { pdfPages } from "@/lib/sheets/extract";
import { saveUpload } from "@/lib/storage";
import { ADD_ONS, BASEMENTS, scopeOf, type AddOn, type Basement, type HomeScope } from "./homes";

export class WorkOrderError extends Error {}

/** Treat a file as a PDF only if it starts with the PDF signature. */
export const isPdf = (b: Uint8Array) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

/** Add-ons named in an option / selection description. */
export function addOnsIn(text: string): AddOn[] {
  const t = text.toLowerCase();
  const out: AddOn[] = [];
  if (/covered\s+(rear\s+)?(deck|patio)/.test(t)) out.push("Covered Rear Deck");
  if (/cantilever\w*\s+pantry/.test(t)) out.push("Cantilevered Pantry");
  if (/in[-\s]?law|next[-\s]?gen|multi[-\s]?gen/.test(t)) out.push("In-Law Suite");
  if (/ext(ended|\.)?\s+(front\s+)?porch/.test(t)) out.push("Ext Front Porch");
  return out;
}

// ---------- Hubbell ToolKit work orders (read line by line) ----------
export type ParsedWorkOrder = {
  builder: string | null;
  number: string;
  date: string | null;
  street: string | null;
  city: string | null;
  development: string | null;
  model: string | null;
  elevation: string | null;
  lot: string | null;
  scope: HomeScope | null;
  costLine: string | null;
  total: number | null;
  options: string[]; // this work order's options, with their amounts
  otherOptions: string[]; // "additional options on other work orders" (house add-ons only)
};

const money = (s: string) => Number(s.replace(/,/g, ""));
const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A ToolKit work order's text → its fields, or null if the text isn't one. */
export function parseToolkitWorkOrder(text: string): ParsedWorkOrder | null {
  const num = text.match(/WORK ORDER:\s*(\d{4,})/);
  if (!num || !/MODEL\/ELEVATION/.test(text)) return null;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const builder = lines[0]?.split(/\s+WORK ORDER:/)[0].trim() || null;
  // house address: the first street line after "HOUSE ADDRESS:", then the first "City, ST 12345" after that
  let street: string | null = null;
  let city: string | null = null;
  const h = lines.findIndex((l) => /^HOUSE ADDRESS:/.test(l));
  if (h >= 0)
    for (const l of lines.slice(h + 1, h + 8)) {
      if (!street && /^\d+\s+[A-Za-z]/.test(l) && !/^\d{3}-/.test(l)) street = l.replace(/\.$/, "");
      else if (street && !city && /^[A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}/.test(l)) city = l;
    }
  const hdr = lines.findIndex((l) => /^DEVELOPMENT\b.*MODEL\/ELEVATION/.test(l));
  const row = hdr >= 0 ? (lines[hdr + 1] ?? "") : "";
  const me = row.match(/\)\s*(.+?)\s*\/\s*Elev(?:ation)?\.?\s+(\S+)\s+(\d+\s*\/\s*\d+)?/i);
  const dev = row.match(/^\d+\s+\S+\s+(.+?)\s+\d{5,}\s/);
  // body: cost lines "325-01 Roofing Labor - Roof Labor 13,966.01", option lines "10050 1 COVERED DECK/PATIO"
  const start = lines.findIndex((l) => /^Cost Code\b/.test(l));
  const end = lines.findIndex((l) => /^This is your Work Order/.test(l));
  let costLine: string | null = null;
  let total: number | null = null;
  const options: { text: string; amount: number | null }[] = [];
  const otherOptions: string[] = [];
  let other = false;
  let last: "option" | "cost" | null = null;
  for (const l of lines.slice(start + 1, end < 0 ? undefined : end)) {
    const t = l.match(/^TOTAL\s+(-?[\d,]+\.\d{2})$/);
    if (t) {
      total = money(t[1]);
      continue;
    }
    if (/^ADDITIONAL OPTIONS ON OTHER WORK ORDERS/i.test(l)) {
      other = true;
      continue;
    }
    if (/^COMMENTS$/i.test(l)) continue;
    const c = l.match(/^(\d{3}-\d{2})\s+(.+?)\s+(-?[\d,]+\.\d{2})$/);
    if (c) {
      costLine ??= c[2];
      // an option's amount is on the "Options" cost line that follows it
      const open = options.findLast((o) => o.amount == null);
      if (/options/i.test(c[2]) && open && last === "option") open.amount = money(c[3]);
      last = "cost";
      continue;
    }
    const o = l.match(/^(\d{4,6})\s+(\d+)\s+(.+)$/);
    if (o) {
      if (other) otherOptions.push(o[3]);
      else options.push({ text: o[3], amount: null });
      last = "option";
      continue;
    }
    // a continuation line under an option ("SHINGLE COLOR" → "Black")
    if (last === "option" && !other && options.length) options[options.length - 1].text += `: ${l}`;
    else if (last === "option" && other && otherOptions.length) otherOptions[otherOptions.length - 1] += `: ${l}`;
  }
  return {
    builder,
    number: num[1],
    date: text.match(/DATE:\s*(\d{1,2}\/\d{1,2}\/\d{4})/)?.[1] ?? null,
    street,
    city,
    development: dev?.[1] ?? null,
    model: me?.[1]?.trim() ?? null,
    elevation: me?.[2] ?? null,
    lot: me?.[3]?.replace(/\s+/g, " ") ?? null,
    scope: scopeOf(costLine),
    costLine,
    total,
    options: options.map((x) => (x.amount ? `${x.text} (${fmt(x.amount)})` : x.text)),
    otherOptions,
  };
}

// ---------- plan set cover sheet (AI on the page's text) ----------
const CoverSchema = z.object({
  elevation_type: z.string().nullable().describe('Elevation type selection exactly as printed, e.g. "B (Extended Porch w/ Shed Dormer)"'),
  basement: z.enum(["FULL_DIG", "WALKOUT", "DAYLIGHT"]).nullable().describe("Basement type selection; null if not printed"),
  basement_finish: z.string().nullable().describe("Basement finish selection as printed"),
  deck_patio: z.string().nullable().describe('Deck/patio selection as printed, e.g. "B (Upgraded Patio)"'),
  garage: z.string().nullable().describe('Garage size if printed, e.g. "3-car" from a "3C" plan code'),
  add_ons: z.array(z.enum(ADD_ONS)).describe("Add-ons the selections show for this house"),
});
export type CoverRead = z.infer<typeof CoverSchema>;

const COVER_TASK = `Read the cover sheet text of a home builder's plan set (one new-construction house) and return its selections.
The selections are printed as a header row of names ("--- eLEVATION TYPE --- basement type --- basement finish --- Deck/patio ---") and a "SELECTIONS:" row with one value per name in the same order; the text may be out of order around them.
Rules:
- Copy values exactly as printed. If a selection isn't printed, return null. Never guess.
- basement: FULL_DIG for "Full Dig" / full / standard basement (a plan code ending "FD" means full dig); WALKOUT for walkout / walk-out; DAYLIGHT for daylight / view-out.
- garage: from a plan line such as "8806 Paloma 1904 / 3410 5BR 3C FD" ("3C" = 3-car); null if not printed.
- add_ons: include an add-on only when a selection names it: "Covered Rear Deck" (covered deck / covered patio), "Cantilevered Pantry", "In-Law Suite" (in-law / next-gen suite), "Ext Front Porch" (extended front porch, e.g. an elevation "w/ Extended Porch").`;

// ---------- any other builder's work order (AI on the whole document) ----------
const OtherSchema = z.object({
  builder: z.string().nullable(),
  street: z.string().nullable().describe("House street address, without city"),
  city: z.string().nullable().describe("City, ST ZIP"),
  lot: z.string().nullable(),
  model: z.string().nullable().describe("House plan / model name"),
  elevation: z.string().nullable().describe("Elevation letter or name, without the word Elevation"),
  scope: z.enum(["Roofing", "Siding", "Gutters", "Roof Seal", "Columns"]).nullable().describe("Which of these the work order is for; null if none"),
  number: z.string().nullable().describe("Work order / PO number"),
  total: z.number().nullable().describe("Work order total in dollars"),
  basement: z.enum(["FULL_DIG", "WALKOUT", "DAYLIGHT"]).nullable(),
  options: z.array(z.string()).describe("Options listed on it, short, as printed"),
  add_ons: z.array(z.enum(ADD_ONS)),
});
const OTHER_TASK = `Read a home builder's work order / purchase order for one new-construction house. Transcribe only what's printed; null when a field isn't there. Never guess a model, elevation, address, number or amount.
add_ons: "Covered Rear Deck" (covered deck / patio), "Cantilevered Pantry", "In-Law Suite" (in-law / next-gen), "Ext Front Porch" (extended front porch) — only when listed for this house.`;

// ---------- the packet ----------
export type PacketScope = { scope: HomeScope; workOrder: string | null; sell: number | null; notes: string; fileUrl: string };
export type Packet = {
  builder: string | null;
  street: string | null;
  city: string | null;
  model: string | null;
  elevation: string | null;
  elevationType: string | null;
  basement: Basement | null;
  addOns: AddOn[];
  houseInfo: string[];
  scopes: PacketScope[];
  planUrl: string | null;
  read: string[]; // what each file was read as
  problems: string[];
};

type AiCall = typeof aiParse;

/** Read a house's work orders and plan set. Each file is saved; a file that can't be read is said so, never guessed. */
export async function readPacket(files: { bytes: Uint8Array; name: string }[], ai: AiCall = aiParse): Promise<Packet> {
  if (!files.length) throw new WorkOrderError("Drop the work orders (and the plan set) as PDFs.");
  if (files.length > 15) throw new WorkOrderError("Drop at most 15 files at a time.");
  const p: Packet = { builder: null, street: null, city: null, model: null, elevation: null, elevationType: null, basement: null, addOns: [], houseInfo: [], scopes: [], planUrl: null, read: [], problems: [] };
  const add = (xs: string[]) => {
    for (const a of xs) if ((ADD_ONS as readonly string[]).includes(a) && !p.addOns.includes(a as AddOn)) p.addOns.push(a as AddOn);
  };
  const info = (x: string | null | undefined) => {
    if (x && !p.houseInfo.includes(x)) p.houseInfo.push(x);
  };
  const same = (k: "builder" | "street" | "city" | "model" | "elevation", v: string | null, file: string) => {
    if (!v) return;
    if (!p[k]) p[k] = v;
    else if (p[k]!.toLowerCase().replace(/\W/g, "") !== v.toLowerCase().replace(/\W/g, "")) p.problems.push(`${file}: ${k} "${v}" doesn't match "${p[k]}" from the other files — check it.`);
  };
  const addScope = (s: PacketScope) => {
    const cur = p.scopes.find((x) => x.scope === s.scope);
    if (!cur) return p.scopes.push(s);
    // two work orders for one scope: sell adds up, both numbers kept
    cur.workOrder = [cur.workOrder, s.workOrder].filter(Boolean).join(", ");
    cur.sell = cur.sell == null && s.sell == null ? null : (cur.sell ?? 0) + (s.sell ?? 0);
    cur.notes = [cur.notes, s.notes].filter(Boolean).join(" · ");
  };

  for (const f of files) {
    if (!isPdf(f.bytes)) {
      p.problems.push(`${f.name}: not a PDF — skipped.`);
      continue;
    }
    if (f.bytes.length > 30 * 1024 * 1024) {
      p.problems.push(`${f.name}: over 30 MB — skipped.`);
      continue;
    }
    let pages: string[] = [];
    try {
      pages = await pdfPages(f.bytes);
    } catch {
      p.problems.push(`${f.name}: couldn't open this PDF.`);
      continue;
    }
    const fileUrl = await saveUpload(f.bytes, f.name, "work-orders");
    const wo = parseToolkitWorkOrder(pages[0] ?? "");
    if (wo) {
      same("builder", wo.builder, f.name);
      same("street", wo.street, f.name);
      same("city", wo.city, f.name);
      same("model", wo.model, f.name);
      same("elevation", wo.elevation, f.name);
      if (wo.lot) info(`Block / lot ${wo.lot}${wo.development ? ` · ${wo.development}` : ""}`);
      add([...wo.options, ...wo.otherOptions].flatMap(addOnsIn));
      if (!wo.scope) p.problems.push(`${f.name}: work order ${wo.number} is for "${wo.costLine ?? "?"}", not roofing, siding, gutters, roof seal or columns — not added.`);
      else addScope({ scope: wo.scope, workOrder: wo.number, sell: wo.total, notes: wo.options.join(" · "), fileUrl });
      p.read.push(`${f.name}: work order ${wo.number}${wo.scope ? ` · ${wo.scope}` : ""}${wo.total != null ? ` · ${fmt(wo.total)}` : ""}`);
      continue;
    }
    const cover = pages[0] ?? "";
    if (pages.length > 2 || /SELECTIONS:|Cover Sheet/i.test(cover)) {
      // a plan set: only its cover sheet's text goes to the AI
      p.planUrl ??= fileUrl;
      try {
        const { data } = await ai({ task: COVER_TASK, schema: CoverSchema, effort: "low", maxTokens: 2000, messages: [{ role: "user", content: [{ type: "text", text: `Cover sheet text:\n\n${cover.slice(0, 20000)}` }] }] });
        p.elevationType ??= data.elevation_type;
        p.basement ??= data.basement;
        add(data.add_ons);
        if (data.elevation_type) add(addOnsIn(data.elevation_type));
        if (data.deck_patio) {
          info(`Deck/patio: ${data.deck_patio}`);
          add(addOnsIn(data.deck_patio));
        }
        if (data.basement_finish) info(`Basement finish: ${data.basement_finish}`);
        if (data.garage) info(`Garage: ${data.garage}`);
        p.read.push(`${f.name}: plan set (${pages.length} pages) — cover sheet selections read`);
      } catch (e) {
        p.problems.push(`${f.name}: plan set saved, but its cover sheet couldn't be read (${aiErrorMessage(e)}). Fill in the elevation type, basement and add-ons.`);
      }
      continue;
    }
    // some other builder's work order
    try {
      const text = pages.join("\n").trim();
      const content = text.length > 200 ? [{ type: "text" as const, text: `Work order text:\n\n${text.slice(0, 40000)}` }] : [{ type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: Buffer.from(f.bytes).toString("base64") } }];
      const { data } = await ai({ task: OTHER_TASK, schema: OtherSchema, effort: "low", maxTokens: 3000, messages: [{ role: "user", content }] });
      same("builder", data.builder, f.name);
      same("street", data.street, f.name);
      same("city", data.city, f.name);
      same("model", data.model, f.name);
      same("elevation", data.elevation, f.name);
      p.basement ??= data.basement;
      add([...data.add_ons, ...data.options.flatMap(addOnsIn)]);
      if (data.lot) info(`Lot ${data.lot}`);
      if (data.scope) addScope({ scope: data.scope, workOrder: data.number, sell: data.total, notes: data.options.join(" · "), fileUrl });
      else p.problems.push(`${f.name}: couldn't tell which scope this work order is for — not added.`);
      p.read.push(`${f.name}: work order${data.number ? ` ${data.number}` : ""}${data.scope ? ` · ${data.scope}` : ""} (read by AI — check it)`);
    } catch (e) {
      p.problems.push(`${f.name}: couldn't be read (${aiErrorMessage(e)}).`);
    }
  }
  if (p.scopes.length || p.planUrl) p.basement ??= "FULL_DIG";
  return p;
}
