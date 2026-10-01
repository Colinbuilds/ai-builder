// AIA pay applications. The schedule of values per contract comes from the Commercial schedule's AIAs tab
// (until BTRpro is the source) and each month's application is made here: enter work completed this period
// and materials stored per line; the app does the G702 math and prints G702 + G703.
import { createHash } from "node:crypto";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { prisma } from "@/lib/db";
import { BTR } from "@/lib/company";
import type { Tab } from "@/lib/import/xlsx";
import { norm, parseMoney } from "@/lib/import/schedule";
import { safe } from "@/lib/pdf/writer";

export type SovLine = { item: string; description: string; scheduled: number; previous: number; thisPeriod: number; stored: number };
export class PayAppError extends Error {}
type Actor = { id: string; name: string };

const r2 = (n: number) => Math.round(n * 100) / 100;
const m = (v: string | undefined) => {
  const n = parseMoney(v);
  return n == null || !Number.isFinite(n) ? 0 : r2(n);
};
const t = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

/** G702 numbers for a set of lines. */
export function payTotals(lines: SovLine[], retainagePct: number) {
  const scheduled = r2(lines.reduce((a, l) => a + l.scheduled, 0));
  const previous = r2(lines.reduce((a, l) => a + l.previous, 0));
  const thisPeriod = r2(lines.reduce((a, l) => a + l.thisPeriod, 0));
  const stored = r2(lines.reduce((a, l) => a + l.stored, 0));
  const completed = r2(previous + thisPeriod + stored);
  const retainage = r2((completed * retainagePct) / 100);
  const earnedLessRet = r2(completed - retainage);
  return { scheduled, previous, thisPeriod, stored, completed, pct: scheduled ? completed / scheduled : 0, balance: r2(scheduled - completed), retainage, earnedLessRet };
}

// ---------- reading the AIAs tab ----------
/** Each project block: a summary row (GC, Project, Contract Total…), then ITEM rows until TOTALS. CCO blocks are skipped. */
export function parseAiaTab(tab: Tab) {
  const out: { gc: string | null; project: string; superName: string | null; submitVia: string | null; dueNote: string | null; pendingCOs: number | null; lines: SovLine[] }[] = [];
  let superName: string | null = null;
  let cur: (typeof out)[number] | null = null;
  let inSov = false;
  for (const r of tab.rows) {
    const cells = r.map(t);
    const filled = cells.filter(Boolean);
    if (!filled.length) continue;
    if (/^general contractor$/i.test(cells[0])) continue;
    if (filled.length === 1 && !cells[1] && !/^\d/.test(cells[0])) {
      // super label is a first name ("Jarrod"); multi-word single cells are project-name echoes above CCO blocks
      if (/^[A-Za-z]+$/.test(cells[0])) superName = cells[0];
      continue;
    }
    if (/^(pending cco|approved cco)/i.test(cells[0])) {
      inSov = false;
      continue;
    }
    if (/^item$/i.test(cells[0])) {
      inSov = true;
      continue;
    }
    if (cells[1] === "TOTALS") {
      inSov = false;
      continue;
    }
    // summary row: project name + numeric contract total
    if (cells[1] && !/^[\d.]+$/.test(cells[0]) && m(cells[2]) > 0 && !inSov && !/place holder/i.test(cells[0])) {
      cur = { gc: cells[0] || null, project: cells[1], superName, submitVia: cells[10] || null, dueNote: cells[11] || null, pendingCOs: m(cells[9]) || null, lines: [] };
      out.push(cur);
      continue;
    }
    if (inSov && cur && /^\d+\.?\d*$/.test(cells[0]) && cells[1]) {
      cur.lines.push({ item: String(Number.parseFloat(cells[0])), description: cells[1], scheduled: m(cells[2]), previous: m(cells[3]), thisPeriod: m(cells[4]), stored: m(cells[5]) });
    }
  }
  return out.filter((c) => c.lines.length);
}

export async function syncPayAppsFromTabs(tabs: Tab[]) {
  const tab = tabs.find((x) => /^aias?$/i.test(x.name.trim()));
  if (!tab) return { contracts: 0 };
  const parsed = parseAiaTab(tab);
  for (const c of parsed) {
    const sourceKey = "aia:" + createHash("sha1").update(`${norm(c.gc)}|${norm(c.project)}`).digest("hex").slice(0, 24);
    const cur = await prisma.payContract.findUnique({ where: { sourceKey } });
    if (cur?.source === "APP") continue;
    const data = { gc: c.gc, project: c.project, superName: c.superName, lines: c.lines, submitVia: c.submitVia, dueNote: c.dueNote, pendingCOs: c.pendingCOs, source: "SHEET" };
    if (cur) await prisma.payContract.update({ where: { id: cur.id }, data });
    else await prisma.payContract.create({ data: { ...data, sourceKey } });
  }
  return { contracts: parsed.length };
}

// ---------- making applications ----------
export async function updateContract(id: string, patch: { retainagePct?: number | null; submitVia?: string | null; dueNote?: string | null; projectId?: string | null; lines?: SovLine[] }, a: Actor) {
  return prisma.payContract.update({ where: { id }, data: { ...patch, lines: patch.lines ?? undefined, source: "APP", updatedBy: a.name } });
}

/** Starts the next application: previous = everything billed so far (completed to date), this period = 0. */
export async function newPayApp(contractId: string, periodTo: Date, a: Actor) {
  const c = await prisma.payContract.findUniqueOrThrow({ where: { id: contractId }, include: { apps: { orderBy: { number: "desc" }, take: 1 } } });
  if (c.retainagePct == null) throw new PayAppError("Set the retainage % for this contract first (it's on the GC's contract — often 5% or 10%).");
  const last = c.apps[0];
  if (last?.status === "DRAFT") throw new PayAppError(`Application #${last.number} is still a draft. Finish or delete it first.`);
  const base = (last ? (last.lines as SovLine[]) : (c.lines as SovLine[])).map((l) => ({ ...l, previous: last ? r2(l.previous + l.thisPeriod + l.stored) : l.previous, thisPeriod: 0, stored: 0 }));
  // lines added to the contract since the last application (change orders) join with nothing billed yet
  for (const l of c.lines as SovLine[]) if (!base.some((b) => b.item === l.item && b.description === l.description)) base.push({ ...l, previous: 0, thisPeriod: 0, stored: 0 });
  return prisma.payApp.create({ data: { contractId, number: (last?.number ?? 0) + 1, periodTo, lines: base, retainagePct: c.retainagePct, createdBy: a.name } });
}

export async function savePayAppLines(id: string, entries: { item: string; thisPeriod: number; stored: number }[]) {
  const p = await prisma.payApp.findUniqueOrThrow({ where: { id } });
  if (p.status !== "DRAFT") throw new PayAppError("This application was already submitted. Start a new one for the next period.");
  const lines = (p.lines as SovLine[]).map((l) => {
    const e = entries.find((x) => x.item === l.item);
    return e ? { ...l, thisPeriod: r2(e.thisPeriod), stored: r2(e.stored) } : l;
  });
  const over = lines.filter((l) => l.previous + l.thisPeriod + l.stored > l.scheduled + 0.005);
  if (over.length) throw new PayAppError(`Billed more than the scheduled value on: ${over.map((l) => `${l.item} ${l.description}`).join("; ")}.`);
  return prisma.payApp.update({ where: { id }, data: { lines } });
}

export async function setPayAppStatus(id: string, status: "SUBMITTED" | "PAID" | "DRAFT") {
  return prisma.payApp.update({ where: { id }, data: { status, submittedAt: status === "SUBMITTED" ? new Date() : undefined, paidAt: status === "PAID" ? new Date() : undefined } });
}

// ---------- G702 / G703 PDF ----------
export async function payAppPdf(id: string) {
  const p = await prisma.payApp.findUniqueOrThrow({ where: { id }, include: { contract: { include: { apps: { select: { number: true, lines: true, retainagePct: true } } } } } });
  const lines = p.lines as SovLine[];
  const T = payTotals(lines, p.retainagePct);
  const prevCert = p.contract.apps.filter((x) => x.number < p.number).length
    ? payTotals((p.contract.apps.find((x) => x.number === p.number - 1)?.lines as SovLine[]) ?? [], p.retainagePct).earnedLessRet
    : 0;
  const due = r2(T.earnedLessRet - prevCert);
  const doc = await PDFDocument.create();
  doc.setTitle(safe(`${p.contract.project} — Application ${p.number}`));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const day = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "America/Chicago" });
  const txt = (pg: PDFPage, s: string, x: number, y: number, o: { size?: number; f?: PDFFont; right?: boolean } = {}) => {
    const size = o.size ?? 9;
    const f = o.f ?? font;
    const str = safe(s);
    pg.drawText(str, { x: o.right ? x - f.widthOfTextAtSize(str, size) : x, y, size, font: f, color: rgb(0.08, 0.08, 0.1) });
  };

  // G702 — application and certificate for payment
  const pg = doc.addPage([612, 792]);
  txt(pg, "APPLICATION AND CERTIFICATE FOR PAYMENT", 40, 750, { size: 13, f: bold });
  txt(pg, "(AIA G702 format)", 40, 736, { size: 8 });
  const left = [
    ["To (contractor):", p.contract.gc ?? ""],
    ["Project:", p.contract.project],
    ["From (subcontractor):", `${BTR.name}, ${BTR.proposalAddress.join(", ")}`],
  ];
  left.forEach(([k, v], i) => {
    txt(pg, k, 40, 708 - i * 14, { f: bold });
    txt(pg, v, 150, 708 - i * 14);
  });
  txt(pg, `Application No: ${p.number}`, 572, 708, { right: true, f: bold });
  txt(pg, `Period to: ${day(p.periodTo)}`, 572, 694, { right: true });
  txt(pg, `Date: ${day(new Date())}`, 572, 680, { right: true });
  const rows: [string, number][] = [
    ["1. Original contract sum + change orders (scheduled value)", T.scheduled],
    ["2. Contract sum to date", T.scheduled],
    ["3. Total completed & stored to date (G703 col. G)", T.completed],
    [`4. Retainage (${p.retainagePct}% of completed work and stored material)`, T.retainage],
    ["5. Total earned less retainage (line 3 less line 4)", T.earnedLessRet],
    ["6. Less previous certificates for payment", prevCert],
    ["7. CURRENT PAYMENT DUE", due],
    ["8. Balance to finish, including retainage (line 2 less line 5)", r2(T.scheduled - T.earnedLessRet)],
  ];
  let y = 630;
  for (const [k, v] of rows) {
    const big = k.startsWith("7.");
    if (big) pg.drawRectangle({ x: 36, y: y - 5, width: 540, height: 18, color: rgb(0.93, 0.93, 0.95) });
    txt(pg, k, 40, y, { f: big ? bold : font });
    txt(pg, usd(v), 572, y, { right: true, f: big ? bold : font });
    y -= 22;
  }
  y -= 20;
  txt(pg, "The undersigned subcontractor certifies that to the best of its knowledge the work covered by this application has been", 40, y, { size: 8 });
  txt(pg, "completed in accordance with the contract documents, and that all amounts have been paid for work for which previous", 40, y - 11, { size: 8 });
  txt(pg, "certificates for payment were issued and payments received, and that current payment shown herein is now due.", 40, y - 22, { size: 8 });
  y -= 80;
  pg.drawLine({ start: { x: 40, y }, end: { x: 300, y }, thickness: 1, color: rgb(0, 0, 0) });
  pg.drawLine({ start: { x: 330, y }, end: { x: 572, y }, thickness: 1, color: rgb(0, 0, 0) });
  txt(pg, `${BTR.name} — authorized signature`, 40, y - 12, { size: 8 });
  txt(pg, "Date", 330, y - 12, { size: 8 });

  // G703 — continuation sheet
  const cols: [string, number, boolean][] = [
    ["Item", 30, false],
    ["Description of work", 190, false],
    ["Scheduled value", 70, true],
    ["From previous", 70, true],
    ["This period", 66, true],
    ["Stored", 56, true],
    ["Completed & stored", 74, true],
    ["%", 34, true],
    ["Balance", 66, true],
    ["Retainage", 62, true],
  ];
  const W = 792;
  let page = doc.addPage([W, 612]);
  let yy = 0;
  const header = () => {
    txt(page, `CONTINUATION SHEET (G703) — ${p.contract.project} — Application ${p.number}, period to ${day(p.periodTo)}`, 30, 580, { size: 10, f: bold });
    let x = 30;
    for (const [h, w, right] of cols) {
      txt(page, h, right ? x + w - 3 : x + 2, 556, { size: 7.5, f: bold, right });
      x += w;
    }
    page.drawLine({ start: { x: 30, y: 552 }, end: { x: W - 30, y: 552 }, thickness: 0.8, color: rgb(0, 0, 0) });
    yy = 538;
  };
  header();
  const row = (vals: string[], b = false) => {
    if (yy < 40) {
      page = doc.addPage([W, 612]);
      header();
    }
    let x = 30;
    vals.forEach((v, i) => {
      const [, w, right] = cols[i];
      const f = b ? bold : font;
      let s = safe(v);
      while (f.widthOfTextAtSize(s, 7.5) > w - 4 && s.length > 3) s = s.slice(0, -2);
      txt(page, s, right ? x + w - 3 : x + 2, yy, { size: 7.5, f: b ? bold : font, right });
      x += w;
    });
    yy -= 13;
  };
  const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  for (const l of lines) {
    const done = l.previous + l.thisPeriod + l.stored;
    row([l.item, l.description, money(l.scheduled), money(l.previous), money(l.thisPeriod), money(l.stored), money(done), l.scheduled ? `${Math.round((done / l.scheduled) * 100)}%` : "", money(l.scheduled - done), money((done * p.retainagePct) / 100)]);
  }
  row(["", "GRAND TOTAL", money(T.scheduled), money(T.previous), money(T.thisPeriod), money(T.stored), money(T.completed), `${Math.round(T.pct * 100)}%`, money(T.balance), money(T.retainage)], true);
  return doc.save();
}
