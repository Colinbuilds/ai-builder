// Readers for the bid boards BTRpro watches. Pure functions (HTML in, postings out) so each is tested against
// a saved copy of the real page. Times on these boards are Central; they're stored as real UTC instants.
import placesJson from "./places.json";

export type Posting = { title: string; number?: string | null; agency?: string | null; city?: string | null; state?: string | null; dueAt?: Date | null; postedAt?: Date | null; url?: string | null; summary?: string | null };

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—" };
export const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
export const textOf = (html: string) =>
  decode(
    html
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
const clean = (s: string) => textOf(s).replace(/\s+/g, " ").trim();

/** Wall-clock time in Central → UTC instant (handles CST/CDT). */
export function central(y: number, mo: number, d: number, h = 17, mi = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value]),
  );
  const asCentral = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess + (guess - asCentral));
}

/** "10/6/2026 11:00:00 AM (CT)", "09/01/2026 2:00 PM CT", "10/8/2026" → Date (no time = 5 PM). */
export function parseUsDate(s: string | null | undefined): Date | null {
  const m = s?.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M))?/i);
  if (!m) return null;
  let h = 17;
  let mi = 0;
  if (m[4]) {
    h = (Number(m[4]) % 12) + (m[6].toUpperCase() === "PM" ? 12 : 0);
    mi = Number(m[5]);
  }
  return central(Number(m[3]), Number(m[1]), Number(m[2]), h, mi);
}

const abs = (href: string, base: string) => {
  try {
    return new URL(decode(href), base).toString();
  } catch {
    return null;
  }
};

/** "Omaha, NE" → { city, state } */
export function splitPlace(s: string | null | undefined) {
  const m = s?.trim().match(/^(.+?),\s*([A-Z]{2})\b/);
  return m ? { city: m[1].trim(), state: m[2] } : { city: s?.trim() || null, state: null };
}

/** Standard Digital Imaging plan room: cards with title, "Bid Date: …", "City, ST". */
export function parseSdi(html: string, base = "https://standarddigital.com/the-plan-room"): Posting[] {
  const out: Posting[] = [];
  const re = /<h4>\s*<a href="([^"]+)">([\s\S]*?)<\/a>\s*<\/h4>\s*<div class="bid-date">\s*<span>([\s\S]*?)<\/span>\s*<\/div>\s*<p>([\s\S]*?)<\/p>/g;
  for (const m of html.matchAll(re)) {
    const title = clean(m[2]);
    const place = splitPlace(clean(m[4]));
    // "( Hausmann Construction is the Construction Manager )" names who's taking bids
    const gc = title.match(/\(\s*([^)]+?)\s+is the\s+([^)]+?)\s*\)/i);
    out.push({ title, url: abs(m[1], base), dueAt: parseUsDate(clean(m[3])), ...place, agency: gc ? `${gc[1]} (${gc[2].toLowerCase()})` : null });
  }
  return out;
}

/** IonWave "Current Bid Opportunities" grid: number, title, type, organization, issued, closes. */
export function parseIonWave(html: string, base: string): { postings: Posting[]; pages: number } {
  const out: Posting[] = [];
  for (const row of html.matchAll(/<tr class="rg(?:Alt)?Row"[\s\S]*?<\/tr>/g)) {
    const cells = [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => clean(c[1]));
    if (cells.length < 7) continue;
    const [, number, title, type, org, issued, closes] = cells;
    if (!title) continue;
    out.push({ number, title, agency: [org, type].filter(Boolean).join(" · ") || null, postedAt: parseUsDate(issued), dueAt: parseUsDate(closes), url: base });
  }
  const pages = Number(html.match(/items in\s*<strong>(\d+)<\/strong>\s*pages/)?.[1] ?? 1);
  return { postings: out, pages };
}

/** CivicEngage (CivicPlus) "Bid Postings" page. */
export function parseCivic(html: string, base: string): Posting[] {
  const out: Posting[] = [];
  for (const m of html.matchAll(/<div class="listItemsRow bid[^"]*">([\s\S]*?)(?=<div class="listItemsRow bid|<\/div>\s*<\/div>\s*<\/div>\s*<div class="(?!listItemsRow))/g)) {
    const block = m[1];
    const link = block.match(/<a href="([^"]+)">([\s\S]*?)<\/a>/);
    if (!link) continue;
    const spans = [...block.matchAll(/<span>([\s\S]*?)<\/span>/g)].map((s) => clean(s[1]));
    const status = block.match(/<span>(Open|Closed|Awarded|Cancelled)<\/span>/i)?.[1];
    if (status && !/open/i.test(status)) continue;
    const closes = spans.find((s) => /\d{1,2}\/\d{1,2}\/\d{4}/.test(s));
    const summary = spans[1]?.replace(/\.\.\.\s*\[\s*Read\s*on[\s\S]*$/i, "…").trim() || null;
    out.push({ title: clean(link[2]), url: abs(link[1], base), dueAt: parseUsDate(closes), summary });
  }
  return out;
}

// ---------- relevance ----------
const ROOF = /\b(re-?roof\w*|roof\w*|shingles?|membrane|tpo|epdm|gutters?|downspouts?|skylights?|coping|flashing)\b/i;
const EXT = /\b(siding|exterior|envelope|fa[cç]ade|cladding|soffit|fascia|windows?|tuck-?point\w*|masonry|metal (wall )?panels?|sheet metal|stucco|eifs|hardie)\b/i;
const NOT_BUILDING = /\b(hvac|chiller|boiler|lighting|electrical|generator|back-?up power|plumbing|paving|pavement|resurfac\w*|street|road|highway|interchange|widening|bridge|culvert|sewer|sanitary|storm ?water|water (main|treatment|resource)|lift station|lead service|trail|playground|tree|mowing|janitorial|scooter|vehicle|truck|trailer|equipment|meter|filter|software|services? agreement|master agreement|traffic|signal|sediment|waste|track)\b/i;
const BUILDING = /\b(building|renovation|remodel|addition|school|fire station|library|facility|apartments?|housing|hall|center|headquarters|hq|construction manager|cm ?at ?risk|gmp|bid package|bp ?\d|hangar|clinic|dental|store|church|office|warehouse|shop|barn|stadium|arena|dome|garage|complex)\b/i;

export type Relevance = "ROOFING" | "EXTERIOR" | "BUILDING" | "OTHER";
export function relevance(title: string, summary?: string | null): Relevance {
  const t = `${title} ${summary ?? ""}`;
  if (ROOF.test(t)) return "ROOFING";
  if (EXT.test(t)) return "EXTERIOR";
  if (NOT_BUILDING.test(title)) return "OTHER";
  if (BUILDING.test(t)) return "BUILDING";
  return "OTHER";
}

// ---------- distance ----------
const PLACES = placesJson as unknown as Record<string, [number, number]>;
const HOMES = { Omaha: [41.2565, -95.9345], Lincoln: [40.8136, -96.7026] } as const;
export const normPlace = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.']/g, "")
    .replace(/^saint /, "st ")
    .replace(/^fort /, "ft ")
    .replace(/\s+/g, " ")
    .trim();

function haversine(a: readonly [number, number], b: readonly [number, number]) {
  const R = 3958.8;
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Straight-line miles to the nearer of Omaha / Lincoln; null when the town isn't known. */
export function distance(city: string | null | undefined, state: string | null | undefined) {
  if (!city) return null;
  const n = normPlace(city);
  const keys = state ? [`${n}|${state.toUpperCase()}`] : ["NE", "IA", "KS", "MO", "SD"].map((s) => `${n}|${s}`);
  const at = keys.map((k) => PLACES[k]).find(Boolean);
  if (!at) return null;
  const [name, miles] = (Object.entries(HOMES) as [string, readonly [number, number]][]).map(([k, v]) => [k, haversine(v, at)] as const).sort((a, b) => a[1] - b[1])[0];
  return { miles: Math.round(miles), nearest: name };
}
