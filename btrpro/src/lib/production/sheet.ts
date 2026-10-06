// Reads the "BTR Residential Schedule_Live_" and "BTR Commercial Schedule_Live_" workbooks into production lines.
// Residential: one tab per builder group, a header row, then label rows ("Hildy Upcoming") and job rows.
// Commercial: one "Current - <super>" tab each, where a project header row (name + totals) is followed by its
// work lines (building, trade, crew, payout, paid, sell). AIAs / WIP / material tabs are read elsewhere.
import { createHash } from "node:crypto";
import type { Tab } from "@/lib/import/xlsx";
import { norm, parseDate, parseMoney } from "@/lib/import/schedule";

export type ProdBoard = "UPCOMING" | "CURRENT" | "ADD" | "WARRANTY" | "COMPLETED";
export type ProdRow = {
  sourceKey: string;
  sourceTab: string;
  sourceRow: number;
  market: "RESIDENTIAL" | "COMMERCIAL";
  board: ProdBoard;
  grp: string | null;
  section: string | null;
  project: string | null;
  dateAdded: Date | null;
  estimateNo: string | null;
  builder: string | null;
  location: string | null;
  model: string | null;
  type: string | null;
  crew: string | null;
  superName: string | null;
  salesRep: string | null;
  notes: string | null;
  completed: string | null;
  payout: number | null;
  paidToDate: number | null;
  payoutWeek: number | null;
  sell: number | null;
  approved: string | null;
  billed: string | null;
  btrPaid: string | null;
  billingNotes: string | null;
  // the same dates as real dates, when the sheet cell holds one (drives crew pace, builder pay pace, revenue)
  completedAt: Date | null;
  billedAt: Date | null;
  paidAt: Date | null;
};

const txt = (v: string | undefined) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t && t !== "#VALUE!" && t !== "#REF!" && t !== "#N/A" ? t : null;
};
const LATEST = () => new Date(Date.now() + 3 * 365 * 86_400_000);
const date = (v: string | undefined) => {
  const d = parseDate(v);
  return d && d.getUTCFullYear() >= 2015 && d <= LATEST() ? d : null;
};
const money = (v: string | undefined) => {
  const n = parseMoney(v);
  return n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100;
};
// a date written in a text cell ("x 3/10/26", "OK to pay in full 3/4") reads back as text
const dateText = (v: string | undefined) => {
  const d = date(v);
  return d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(2)}` : txt(v);
};

function keyer(tab: string) {
  const seen = new Map<string, number>();
  return (parts: (string | null | undefined)[]) => {
    const base = [norm(tab), ...parts.map((p) => norm(p ?? ""))].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return "prod:" + createHash("sha1").update(`${base}|${n}`).digest("hex").slice(0, 24);
  };
}
const filled = (r: string[]) => r.map(txt).filter(Boolean) as string[];

// ---------- residential ----------
// Date Added | Estimate # | Builder | Address | Model | Type | Crew | Super | Sales Rep | Notes | Completed | Pay out | Sell | Paid/Approved | Billed | BTR Paid | Billing Notes
function residentialTab(tab: Tab): ProdRow[] {
  const name = tab.name.trim();
  const key = keyer(name);
  const out: ProdRow[] = [];
  const board: ProdBoard = /completed/i.test(name) ? "COMPLETED" : /^add to/i.test(name) ? "ADD" : "CURRENT";
  const grp = /res\.? current/i.test(name) ? "Current" : /add to/i.test(name) ? "Add to schedule" : /weekly billing/i.test(name) ? "Weekly billing" : name.replace(/semis$/i, "Semis").replace(/^CustomsSemis$/i, "Customs/Semis");
  const start = tab.rows.findIndex((r) => /date added/i.test(txt(r[0]) ?? "") && /builder/i.test(txt(r[2]) ?? ""));
  let section: string | null = null;
  tab.rows.forEach((r, i) => {
    if (i <= start) return;
    const f = filled(r);
    if (!f.length) return;
    // label rows: one cell of text ("Hildy Upcoming", "DR Horton Warranty", "Wyatt Madsen")
    if (f.length === 1 && !money(f[0]) && !date(f[0])) {
      section = f[0];
      return;
    }
    if (/^(invoices|billed date)$/i.test(txt(r[0]) ?? "") || /^billed date$/i.test(txt(r[1]) ?? "")) return;
    const builder = txt(r[2]);
    const location = txt(r[3]);
    if (!builder && (!location || /^[\d.,$\s-]+$/.test(location))) return;
    const warranty = /warranty|service|repair/i.test(section ?? "") || /warranty/i.test(txt(r[1]) ?? "");
    const row = {
      market: "RESIDENTIAL" as const,
      board: board === "CURRENT" && warranty ? ("WARRANTY" as const) : board === "CURRENT" && /upcoming/i.test(section ?? "") ? ("UPCOMING" as const) : board,
      grp,
      section,
      project: null,
      dateAdded: date(r[0]),
      estimateNo: txt(r[1]),
      builder,
      location,
      model: txt(r[4]),
      type: txt(r[5]),
      crew: txt(r[6]),
      superName: txt(r[7]),
      salesRep: txt(r[8]),
      notes: [date(r[0]) ? null : txt(r[0]), txt(r[9])].filter(Boolean).join(" · ") || null,
      completed: dateText(r[10]),
      payout: money(r[11]),
      paidToDate: null,
      payoutWeek: null,
      sell: money(r[12]),
      approved: dateText(r[13]),
      billed: dateText(r[14]),
      btrPaid: dateText(r[15]),
      billingNotes: txt(r[16]),
      completedAt: date(r[10]),
      billedAt: date(r[14]),
      paidAt: date(r[15]),
    };
    out.push({ ...row, sourceTab: name, sourceRow: i + 1, sourceKey: key([builder, location, row.type, row.estimateNo]) });
  });
  return out;
}

// ---------- commercial ----------
// (Project) | Builder | Address | Type | Crew | Total Payout | Total Paid to Date | Payout this Week | Remaining | Sell | Super | Sales Rep | Notes | Completed | Billing Notes
function commercialTab(tab: Tab): ProdRow[] {
  const name = tab.name.trim();
  const key = keyer(name);
  const out: ProdRow[] = [];
  const board: ProdBoard = /completed/i.test(name) ? "COMPLETED" : /upcoming/i.test(name) ? "UPCOMING" : "CURRENT";
  const superTab = name.match(/current\s*-\s*(.+)$/i)?.[1]?.trim() ?? null;
  const start = tab.rows.findIndex((r) => /builder/i.test(txt(r[1]) ?? "") && /payout/i.test(txt(r[5]) ?? ""));
  const upcoming = board === "UPCOMING";
  let project: string | null = null;
  tab.rows.forEach((r, i) => {
    if (i <= start) return;
    const f = filled(r);
    if (!f.length || (f.length === 1 && f[0] === "0")) return;
    const a = txt(r[0]);
    const b = txt(r[1]);
    // label row ("Jarrod", "Commercial roofing/siding")
    if (f.length === 1 && a && !money(a)) {
      if (!superTab && !upcoming) project = null;
      return;
    }
    // project header: name in A, nothing in B–E, totals after
    if (a && !b && !txt(r[2]) && !txt(r[3]) && (!upcoming || !/^est/i.test(a))) {
      project = a;
      return;
    }
    if (!b && !txt(r[2])) return;
    const estimateNo = upcoming && a && /^est|^\d/i.test(a) ? a : null;
    const row = {
      market: "COMMERCIAL" as const,
      board,
      grp: superTab ?? (upcoming ? "Upcoming" : "Completed"),
      section: null,
      project: project ?? b,
      dateAdded: null,
      estimateNo,
      builder: b,
      location: txt(r[2]),
      model: null,
      type: txt(r[3]),
      crew: txt(r[4]),
      superName: txt(r[10]),
      salesRep: txt(r[11]),
      notes: [!estimateNo && a && !/^commercial$/i.test(a) && a !== project ? a : null, txt(r[12])].filter(Boolean).join(" · ") || null,
      // a line paid out in full is done even when no one typed it in "Completed"
      completed: dateText(r[13]) ?? ((money(r[5]) ?? 0) > 0 && (money(r[6]) ?? 0) >= (money(r[5]) ?? 0) ? "Paid out in full" : null),
      payout: money(r[5]),
      paidToDate: money(r[6]),
      payoutWeek: money(r[7]),
      sell: money(r[9]),
      approved: (money(r[5]) ?? 0) > 0 && (money(r[6]) ?? 0) >= (money(r[5]) ?? 0) ? "Crew paid in full" : null,
      billed: null,
      btrPaid: null,
      billingNotes: txt(r[14]),
      completedAt: date(r[13]),
      billedAt: null,
      paidAt: null,
    };
    out.push({ ...row, sourceTab: name, sourceRow: i + 1, sourceKey: key([row.project, b, row.location, row.type, row.crew]) });
  });
  return out;
}

export function parseProductionWorkbook(tabs: Tab[], market: "RESIDENTIAL" | "COMMERCIAL") {
  const rows: ProdRow[] = [];
  const summary: { tab: string; rows: number; skipped?: string }[] = [];
  for (const tab of tabs) {
    const n = tab.name.trim();
    let got: ProdRow[] | null = null;
    if (/data_source|quick links|^sheet\d+$|dashboard|material|wip|aia|completed projects/i.test(n)) got = null;
    else if (market === "RESIDENTIAL") got = residentialTab(tab);
    else if (/current|upcoming|^completed$/i.test(n)) got = commercialTab(tab);
    if (got) {
      rows.push(...got);
      summary.push({ tab: n, rows: got.length });
    } else summary.push({ tab: n, rows: 0, skipped: "Not a schedule tab" });
  }
  return { rows, tabs: summary };
}
