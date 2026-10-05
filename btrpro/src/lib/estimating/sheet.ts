// Reads the "BTR Estimating Schedule" workbook (every tab) into estimating-schedule rows.
// The sheet grew by hand over years, so each tab gets its own reader and a few rows are told apart by shape
// (e.g. newer residential rows have the estimator's initials in column D, older ones a date).
import { createHash } from "node:crypto";
import type { Tab } from "@/lib/import/xlsx";
import { norm, parseDate, parseMoney } from "@/lib/import/schedule";
import { appName } from "@/lib/company-profile";

export type Board = "CURRENT" | "MISC" | "PASSING" | "SENT" | "REDRAW" | "LOST" | "SOLD" | "ARCHIVE" | "TRACT";
export type Market = "COMMERCIAL" | "RESIDENTIAL";

export type SheetRow = {
  sourceKey: string;
  sourceTab: string;
  sourceRow: number;
  board: Board;
  market: Market;
  kind: string | null;
  customer: string | null;
  project: string;
  scope: string | null;
  estimator: string | null;
  receivedAt: Date | null;
  dueAt: Date | null;
  sentAt: Date | null;
  bidDate: Date | null;
  status: string | null;
  waitingOn: string | null;
  sentTo: string | null;
  results: string | null;
  notes: string | null;
  folderLink: string | null;
  extra: Record<string, string> | null;
};

export type TabSummary = { tab: string; rows: number; skipped?: string };

const txt = (v: string | undefined) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t && t !== "#VALUE!" && t !== "#REF!" ? t : null;
};
const isInitials = (v: string | undefined) => /^[A-Z]{2,3}$/.test((v ?? "").trim());
// a typo'd year (5/5/55 → 2055) would sort to the top of every list; anything outside 2015–three years out is dropped
const LATEST = new Date(Date.now() + 3 * 365 * 86_400_000);
const date = (v: string | undefined) => {
  const d = parseDate(v);
  return d && d.getUTCFullYear() >= 2015 && d <= LATEST ? d : null;
};
const isDate = (v: string | undefined) => !!date(v);
const dateText = (v: string | undefined) => {
  const d = date(v);
  return d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}` : txt(v);
};
const url = (v: string | null) => (v && /^https?:\/\//i.test(v) ? v : null);
const joinNotes = (...xs: (string | null)[]) => xs.filter(Boolean).join(" · ") || null;

function blank(): Omit<SheetRow, "sourceKey" | "sourceTab" | "sourceRow" | "board" | "market" | "project"> {
  return { kind: null, customer: null, scope: null, estimator: null, receivedAt: null, dueAt: null, sentAt: null, bidDate: null, status: null, waitingOn: null, sentTo: null, results: null, notes: null, folderLink: null, extra: null };
}

/** Stable key: same tab + customer + project + first date → same row, even when rows are inserted above it. */
function keyer(tab: string) {
  const seen = new Map<string, number>();
  return (r: Pick<SheetRow, "customer" | "project" | "receivedAt" | "dueAt" | "bidDate">) => {
    const d = r.receivedAt ?? r.bidDate ?? r.dueAt;
    const base = [norm(tab), norm(r.customer), norm(r.project), d ? d.toISOString().slice(0, 10) : ""].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return "sheet:" + createHash("sha1").update(`${base}|${n}`).digest("hex").slice(0, 24);
  };
}

const extraFrom = (pairs: [string, string | null][]) => {
  const e = Object.fromEntries(pairs.filter((p): p is [string, string] => !!p[1]));
  return Object.keys(e).length ? e : null;
};

// ---------- "BTR Current Estimating" ----------
const LEGEND = /^(standard|asap|sold with rfq|review needed)$/i;
const HEADER = /^(customer|contractor|project)$/i;
const ARCHIVE_BEFORE = new Date("2025-01-01T00:00:00Z");

function currentTab(tab: Tab): SheetRow[] {
  const key = keyer(tab.name);
  const out: SheetRow[] = [];
  let board: Board = "CURRENT";
  let kind: string | null = null;
  // notes and the color legend sit above the first header row; rows start after it
  const start = tab.rows.findIndex((r) => HEADER.test(txt(r[1]) ?? ""));
  tab.rows.forEach((r, i) => {
    if (i <= start) return;
    const a = txt(r[0]);
    const rest = r.slice(1).some((c) => txt(c));
    if (a && !rest) {
      if (/misc/i.test(a)) [board, kind] = ["MISC", null];
      else if (/new build/i.test(a)) [board, kind] = ["CURRENT", "NEW_BUILD"];
      else if (/remodel/i.test(a)) [board, kind] = ["CURRENT", "REMODEL"];
      else if (/passing/i.test(a)) [board, kind] = ["PASSING", null];
      return;
    }
    if (a && LEGEND.test(a)) return;
    if (HEADER.test(txt(r[1]) ?? "") || HEADER.test(txt(r[2]) ?? "")) return;
    const project = txt(r[2]);
    const customer = txt(r[1]);
    if (!project && !customer) return;
    const market: Market = /resid/i.test(a ?? "") ? "RESIDENTIAL" : /commerc/i.test(a ?? "") ? "COMMERCIAL" : kind ? "RESIDENTIAL" : "COMMERCIAL";
    const receivedAt = date(r[5]);
    const dueAt = date(r[6]);
    const old = board === "PASSING" && (dueAt ?? receivedAt) && (dueAt ?? receivedAt)! < ARCHIVE_BEFORE;
    const folderLink = tab.links?.[`${i},10`] ?? url(txt(r[10]));
    const row = {
      ...blank(),
      kind,
      customer,
      project: project ?? customer!,
      scope: txt(r[3]),
      estimator: txt(r[4]),
      receivedAt,
      dueAt,
      status: txt(r[7]),
      sentAt: date(r[8]),
      waitingOn: txt(r[9]),
      folderLink,
      notes: joinNotes(folderLink ? null : txt(r[10]) === "Estimating" ? null : txt(r[10]), txt(r[11])),
      extra: extraFrom([["Due", isDate(r[6]) ? null : txt(r[6])], ["Sent", isDate(r[8]) ? null : txt(r[8])]]),
    };
    out.push({ ...row, board: old ? "ARCHIVE" : board, market, sourceTab: tab.name, sourceRow: i + 1, sourceKey: key(row) });
  });
  return out;
}

// ---------- "BTR PM Sold Jobs" ----------
function soldTab(tab: Tab): SheetRow[] {
  const key = keyer(tab.name);
  const header = (tab.rows[0] ?? []).map((h) => txt(h) ?? "");
  const out: SheetRow[] = [];
  const used = new Set([0, 1, 6, 8, 9, 10, 16]);
  let group: string | null = null;
  tab.rows.forEach((r, i) => {
    if (i === 0) return;
    const filled = r.map(txt).filter(Boolean);
    if (filled.length === 1 && txt(r[0])) {
      group = txt(r[0]);
      return;
    }
    const project = txt(r[1]);
    if (!project) return;
    const row = {
      ...blank(),
      kind: group,
      customer: txt(r[0]),
      project,
      scope: txt(r[9]),
      status: txt(r[6]),
      receivedAt: date(r[10]),
      notes: joinNotes(txt(r[8]), txt(r[16])),
      extra: extraFrom(r.map((c, j) => [header[j] || `Column ${j + 1}`, used.has(j) ? null : dateText(c)] as [string, string | null])),
    };
    out.push({ ...row, board: "SOLD", market: "COMMERCIAL", sourceTab: tab.name, sourceRow: i + 1, sourceKey: key(row) });
  });
  return out;
}

// ---------- commercial follow-up tabs: Bids Completed, Redrawings, Lost ----------
function followUpTab(tab: Tab, board: "SENT" | "REDRAW" | "LOST"): SheetRow[] {
  const key = keyer(tab.name);
  const out: SheetRow[] = [];
  tab.rows.forEach((r, i) => {
    if (i === 0) return;
    const project = txt(r[1]);
    if (!project) return;
    let row: Omit<SheetRow, "sourceKey" | "sourceTab" | "sourceRow" | "board" | "market">;
    // Lost tab's own layout: GC, project, scope, bid date, reason, winning sub, notes, link
    if (board === "LOST" && (isDate(r[3]) || !isDate(r[4]))) {
      const link = tab.links?.[`${i},7`] ?? url(txt(r[7]));
      row = { ...blank(), customer: txt(r[0]), project, scope: txt(r[2]), bidDate: date(r[3]), status: "Lost", notes: joinNotes(txt(r[6]), link ? null : txt(r[7])), folderLink: link, extra: extraFrom([["Reason", txt(r[4])], ["Winning sub", txt(r[5])], ["Bid date", isDate(r[3]) ? null : txt(r[3])]]) };
    } else {
      // GC, project, scope, Hardie exp., bid date, status, results, then tab-specific columns
      const h = txt(r[7]);
      const link = tab.links?.[`${i},7`] ?? url(h);
      row = {
        ...blank(),
        customer: txt(r[0]),
        project,
        scope: txt(r[2]),
        bidDate: date(r[4]),
        status: txt(r[5]),
        results: txt(r[6]),
        folderLink: board === "REDRAW" ? link : null,
        notes: board === "SENT" ? txt(r[9]) : board === "REDRAW" && !link ? h : null,
        extra: extraFrom([
          ["Hardie exp.", dateText(r[3])],
          ...(board === "SENT" ? ([["Missing material quote", h], ["Supplier follow up", txt(r[8])]] as [string, string | null][]) : []),
          ["Bid date", isDate(r[4]) ? null : txt(r[4])],
        ]),
      };
    }
    out.push({ ...row, board, market: "COMMERCIAL", sourceTab: tab.name, sourceRow: i + 1, sourceKey: key(row) });
  });
  return out;
}

// ---------- residential completed bids: New Construction, Remodel, Sharf ----------
function residentialTab(tab: Tab, kind: string, defaultCustomer: string | null = null): SheetRow[] {
  const key = keyer(tab.name);
  const out: SheetRow[] = [];
  tab.rows.forEach((r, i) => {
    if (/^customer$/i.test(txt(r[0]) ?? "")) return;
    const project = txt(r[1]);
    if (!project) return;
    // newer rows: customer, project, scope, estimator, received, due, status, —, bid sent to, —, notes
    const modern = isInitials(r[3]) || (!txt(r[3]) && isDate(r[4]) && isDate(r[5]));
    const row = modern
      ? { ...blank(), customer: txt(r[0]) ?? defaultCustomer, project, scope: txt(r[2]), estimator: txt(r[3]), receivedAt: date(r[4]), dueAt: date(r[5]), status: txt(r[6]), sentTo: txt(r[8]) ?? txt(r[7]), notes: joinNotes(txt(r[8]) ? txt(r[7]) : null, txt(r[9]), txt(r[10])) }
      : { ...blank(), customer: txt(r[0]) ?? defaultCustomer, project, scope: txt(r[2]), receivedAt: date(r[3]), dueAt: date(r[4]), status: txt(r[5]), sentTo: txt(r[7]), notes: joinNotes(txt(r[6]) === "x" ? null : txt(r[6]), txt(r[8])), results: txt(r[9]) };
    out.push({ ...row, kind, board: "SENT", market: "RESIDENTIAL", sourceTab: tab.name, sourceRow: i + 1, sourceKey: key(row) });
  });
  return out;
}

// ---------- Hildy Homes: address, plan, date bid, walkout/daylight, full dig, sell, profit, notes ----------
function hildyTab(tab: Tab): SheetRow[] {
  const key = keyer(tab.name);
  const out: SheetRow[] = [];
  const money = (v: string | undefined) => {
    const n = parseMoney(v);
    return n == null ? txt(v) : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  };
  tab.rows.forEach((r, i) => {
    if (i === 0 && /address/i.test(txt(r[0]) ?? "")) return;
    const project = txt(r[0]);
    if (!project) return;
    const plan = txt(r[1]);
    const row = {
      ...blank(),
      customer: "Hildy Homes",
      project,
      scope: plan && plan !== "x" ? plan : null,
      bidDate: date(r[2]),
      notes: txt(r[7]),
      extra: extraFrom([["Walkout/Daylight", txt(r[3])], ["Full dig", txt(r[4])], ["Sell", money(r[5])], ["Profit", money(r[6])]]),
    };
    out.push({ ...row, kind: "Hildy Homes", board: "SENT", market: "RESIDENTIAL", sourceTab: tab.name, sourceRow: i + 1, sourceKey: key(row) });
  });
  return out;
}

// ---------- Tract Builder Scopes: builder name, then its scope lines ----------
function tractTab(tab: Tab): SheetRow[] {
  const key = keyer(tab.name);
  const out: SheetRow[] = [];
  let cur: { name: string; row: number; lines: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const row = { ...blank(), customer: cur.name, project: `${cur.name} — standard scope`, scope: cur.lines.join("\n") || null };
    out.push({ ...row, kind: "TRACT", board: "TRACT", market: "RESIDENTIAL", sourceTab: tab.name, sourceRow: cur.row, sourceKey: key(row) });
    cur = null;
  };
  tab.rows.forEach((r, i) => {
    const a = txt(r[0]);
    const b = txt(r[1]);
    if (!a) return;
    if (!b && !/labor|material|column|wrap|repair|warranty|gutter|siding|roof|soffit|insulation/i.test(a)) {
      flush();
      cur = { name: a, row: i + 1, lines: [] };
    } else if (cur) cur.lines.push(b ? `${a} — ${b}` : a);
  });
  flush();
  return out;
}

// ---------- "OLD Completed/open" (2022 list) ----------
function oldTab(tab: Tab): SheetRow[] {
  const key = keyer(tab.name);
  const out: SheetRow[] = [];
  tab.rows.forEach((r, i) => {
    if (/^customer$/i.test(txt(r[0]) ?? "")) return;
    const project = txt(r[1]);
    if (!project) return;
    const row = { ...blank(), customer: txt(r[0]), project, scope: txt(r[2]), receivedAt: date(r[3]), dueAt: date(r[4]), status: txt(r[5]), notes: txt(r[6]) === "X" ? null : txt(r[6]), sentTo: txt(r[7]), extra: extraFrom([["Sales", txt(r[8])]]) };
    out.push({ ...row, kind: "2022 list", board: "ARCHIVE", market: "COMMERCIAL", sourceTab: tab.name, sourceRow: i + 1, sourceKey: key(row) });
  });
  return out;
}

/** Every tab of the workbook → rows, plus a per-tab count so the sync can show what it read. */
export function parseEstimatingWorkbook(tabs: Tab[]): { rows: SheetRow[]; tabs: TabSummary[] } {
  const rows: SheetRow[] = [];
  const summary: TabSummary[] = [];
  for (const tab of tabs) {
    const n = tab.name.trim();
    let got: SheetRow[] | null = null;
    if (/current estimating/i.test(n)) got = currentTab(tab);
    else if (/pm sold/i.test(n)) got = soldTab(tab);
    else if (/commercial bids completed/i.test(n)) got = followUpTab(tab, "SENT");
    else if (/redraw/i.test(n)) got = followUpTab(tab, "REDRAW");
    else if (/lost/i.test(n)) got = followUpTab(tab, "LOST");
    else if (/tract builder/i.test(n)) got = tractTab(tab);
    else if (/new construction/i.test(n)) got = residentialTab(tab, "NEW_BUILD");
    else if (/remodel/i.test(n)) got = residentialTab(tab, "REMODEL");
    else if (/hildy/i.test(n)) got = hildyTab(tab);
    else if (/sharf/i.test(n)) got = residentialTab(tab, "Sharf", "Sharf");
    else if (/old/i.test(n)) got = oldTab(tab);
    if (got) {
      rows.push(...got);
      summary.push({ tab: n, rows: got.length });
    } else summary.push({ tab: n, rows: 0, skipped: `Not a tab ${appName()} reads` });
  }
  return { rows, tabs: summary };
}
