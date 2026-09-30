// Finds the pages of a plan set / project manual that matter to a roofing & exterior bid, and trims the PDF
// to them when the whole set is too big to send. Page numbers always refer to the ORIGINAL document.
import { PDFDocument } from "pdf-lib";

export const PLAN_PAGE_CAP = 100; // pages sent per review; dense drawing pages fill context fast
export const PLAN_MAX_BYTES = 30 * 1024 * 1024; // request limit is 32 MB, leave room for the prompt

// Weight per keyword; a page scores each keyword once. Negative = trades we don't bid.
const KEYWORDS: [RegExp, number][] = [
  [/roof plan|roof framing plan/, 6],
  [/sheet index|drawing index|index of drawings|list of drawings/, 5],
  [/division 0?7|section 07\s?\d{2}|\b07 ?\d{2} ?\d{2}\b/, 5],
  [/exterior elevation|\belevations?\b/, 4],
  [/wall section|building section|typ(ical)?\.? section/, 3],
  [/shingle|asphalt roofing|metal roofing|standing seam/, 4],
  [/\btpo\b|\bepdm\b|\bpvc membrane|modified bitumen|single[- ]ply/, 4],
  [/underlayment|ice (and|&) water|ice barrier|synthetic felt/, 3],
  [
    /siding|lap siding|fiber[- ]cement|hardie|smartside|vinyl siding|board (and|&) batten|shake/,
    4,
  ],
  [/weather[- ]resistive barrier|weather barrier|house ?wrap|\bwrb\b|tyvek/, 3],
  [/soffit|fascia|frieze|rake trim|corner board|window trim/, 3],
  [/gutter|downspout|leader/, 2],
  [/flashing|drip edge|counterflashing|kick[- ]?out|step flash/, 2],
  [/ridge vent|attic vent|ventilation|intake vent/, 2],
  [/exterior finish|finish schedule|material legend|exterior materials/, 4],
  [/\bpitch\b|\bslope\b|\d{1,2}\s?:\s?12\b|\d{1,2}\/12\b/, 2],
  [
    /warranty|class 4|ul ?2218|impact[- ]resistant|wind (speed|rating|uplift)|fm ?\d-\d{2,3}/,
    2,
  ],
  [
    /by others|not in contract|n\.?i\.?c\.?|owner[- ]furnished|alternate(s)?\b/,
    2,
  ],
  [/cover sheet|general notes|project data|code analysis/, 1],
  [
    /electrical|lighting plan|panel schedule|plumbing|fixture schedule|hvac|duct|mechanical plan|foundation plan|footing/,
    -3,
  ],
];

export type PageScore = {
  page: number;
  score: number;
  hits: string[];
  hasText: boolean;
};

export function scorePages(pages: string[]): PageScore[] {
  return pages.map((raw, i) => {
    const t = raw.toLowerCase();
    let score = 0;
    const hits: string[] = [];
    for (const [re, w] of KEYWORDS) {
      const m = t.match(re);
      if (m) {
        score += w;
        if (w > 0) hits.push(m[0]);
      }
    }
    return { page: i + 1, score, hits, hasText: t.trim().length > 20 };
  });
}

/** "1-3, 12, 40-45" → [1,2,3,12,40,...,45] (sorted, unique, within 1..total). Throws on bad input. */
export function parsePageRanges(input: string, total: number): number[] {
  const out = new Set<number>();
  for (const part of input.split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m)
      throw new Error(
        `"${part}" isn't a page or range. Use something like 1-3, 12, 40-45.`,
      );
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a || b > total)
      throw new Error(`Pages ${part} are outside 1–${total}.`);
    for (let p = a; p <= b; p++) out.add(p);
  }
  if (!out.size) throw new Error("No pages given.");
  return [...out].sort((x, y) => x - y);
}

export type PageChoice = {
  pages: number[] | null;
  reason: string;
  unreadable: number;
};

/**
 * Picks which original pages to send. null = the whole document fits and nothing was asked for.
 * Scanned pages (no text) can't be scored, so they are only sent when the whole set fits or the estimator names them.
 */
export function choosePages(opts: {
  texts: string[];
  totalPages: number;
  bytes: number;
  manual?: string | null;
  cap?: number;
}): PageChoice {
  const cap = opts.cap ?? PLAN_PAGE_CAP;
  const unreadable = opts.texts.length
    ? scorePages(opts.texts).filter((s) => !s.hasText).length
    : opts.totalPages;
  if (opts.manual?.trim()) {
    const pages = parsePageRanges(opts.manual, opts.totalPages);
    if (pages.length > cap)
      throw new Error(
        `That's ${pages.length} pages; send ${cap} or fewer per review.`,
      );
    return {
      pages,
      reason: `Pages you picked: ${opts.manual.trim()}.`,
      unreadable,
    };
  }
  if (opts.totalPages <= cap && opts.bytes <= PLAN_MAX_BYTES)
    return { pages: null, reason: `All ${opts.totalPages} pages.`, unreadable };
  if (!opts.texts.length || unreadable === opts.totalPages)
    throw new Error(
      `This set is ${opts.totalPages} pages${opts.bytes > PLAN_MAX_BYTES ? ` and ${Math.round(opts.bytes / 1048576)} MB` : ""} and has no readable text (scanned), so the relevant pages can't be found automatically. Enter the page numbers of the roof plan, elevations, sections and Division 07 specs.`,
    );
  const scored = scorePages(opts.texts);
  const keep = new Set<number>([1, 2].filter((p) => p <= opts.totalPages)); // cover + sheet index
  for (const s of [...scored]
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.page - b.page)) {
    if (keep.size >= cap) break;
    keep.add(s.page);
  }
  const pages = [...keep].sort((a, b) => a - b);
  return {
    pages,
    reason: `${pages.length} of ${opts.totalPages} pages picked by content (roof plans, elevations, sections, Division 07, finish schedules).${unreadable ? ` ${unreadable} scanned page(s) couldn't be searched — name them if they matter.` : ""}`,
    unreadable,
  };
}

/** Copies the chosen original pages (1-based) into a new PDF. Drops the lowest-priority pages until it fits the size limit. */
export async function subsetPdf(
  bytes: Uint8Array,
  pages: number[],
  priority?: Map<number, number>,
): Promise<{ bytes: Uint8Array; pages: number[] }> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  let keep = [...pages];
  for (;;) {
    const out = await PDFDocument.create();
    const copied = await out.copyPages(
      src,
      keep.map((p) => p - 1),
    );
    copied.forEach((p) => out.addPage(p));
    const b = await out.save();
    if (b.length <= PLAN_MAX_BYTES) return { bytes: b, pages: keep };
    if (keep.length <= 1)
      throw new Error(
        "Even a single page is over the size limit. Export the plans at a lower resolution.",
      );
    // Drop the lowest-scoring quarter (never page 1) and try again.
    const drop = Math.max(1, Math.floor(keep.length / 4));
    const order = keep
      .filter((p) => p !== 1)
      .sort((a, b) => (priority?.get(a) ?? 0) - (priority?.get(b) ?? 0));
    const gone = new Set(order.slice(0, drop));
    keep = keep.filter((p) => !gone.has(p));
  }
}
