// Customer-facing proposal PDF, laid out like BTR's own estimate form: logo + company + rep, title and date,
// a customer box with the work by section (items only, no unit costs), subtotal, tax, TOTAL, then options,
// scope, terms, and the signature lines. Includes the e-signature record once signed.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Proposal } from "@prisma/client";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { prisma } from "@/lib/db";
import { companyLogo, getCompany } from "@/lib/company-profile";
import { safe } from "@/lib/pdf/writer";
import type { Alternate } from "./price";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const day = (d: Date) => d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", timeZone: "America/Chicago" });
const INK = rgb(0.08, 0.08, 0.1);
const SOFT = rgb(0.4, 0.4, 0.45);
const LINE = rgb(0.82, 0.82, 0.85);
const BAND = rgb(0.94, 0.94, 0.95);

const SECTION_TITLE: Record<string, string> = { MATERIAL_ROOFING: "Roofing Section", MATERIAL_SIDING: "Siding Section", MATERIAL_DECK: "Decking Section" };
const TRADE: [RegExp, string][] = [
  [/roof|shingle|tpo|epdm|membrane|underlay|ridge|flash|drip|ice/i, "MATERIAL_ROOFING"],
  [/siding|hardie|soffit|fascia|trim|wrap|lap|panel/i, "MATERIAL_SIDING"],
  [/deck/i, "MATERIAL_DECK"],
];

type Line = { text: string; sub: string[] };

/** The work grouped the way the customer reads it: one section per trade; labor and job costs go with their trade. */
async function sections(estimateId: string) {
  const [lines, labor] = await Promise.all([
    prisma.estimateLine.findMany({ where: { estimateId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { section: true, itemName: true, note: true } }),
    prisma.laborLine.findMany({ where: { estimateId }, orderBy: [{ sortOrder: "asc" }], select: { task: true } }),
  ]);
  const groups = new Map<string, Line[]>();
  const push = (k: string, l: Line) => groups.set(k, [...(groups.get(k) ?? []), l]);
  // sub-bullets: note lines written as "- item" (e.g. misc materials)
  const subs = (note: string | null) => (note ?? "").split("\n").map((s) => s.trim()).filter((s) => s.startsWith("- ")).map((s) => s.slice(2));
  for (const l of lines) if (SECTION_TITLE[l.section]) push(l.section, { text: l.itemName, sub: subs(l.note) });
  const trades = [...groups.keys()];
  const home = (text: string) => (trades.length === 1 ? trades[0] : (TRADE.find(([re, k]) => re.test(text) && trades.includes(k))?.[1] ?? trades[0] ?? "GENERAL"));
  for (const l of lines) if (!SECTION_TITLE[l.section]) push(home(l.itemName), { text: l.itemName, sub: subs(l.note) });
  for (const l of labor) push(home(l.task), { text: l.task, sub: [] });
  return [...groups.entries()].map(([k, items]) => ({ title: SECTION_TITLE[k] ?? "Work Section", items }));
}

let logoBytes: Buffer | null = null;
const logo = () => (logoBytes ??= readFileSync(path.join(process.cwd(), "src/assets/btr-logo.png")));

/** Everything the proposal page shows — built from a BTRpro proposal, or read from an old Drive proposal. */
export type ProposalView = {
  title: string;
  date: Date;
  number: string | null;
  validUntil: Date | null;
  rep: { name: string; email: string; phone: string | null } | null;
  jobName: string;
  who: string | null;
  address: string | null;
  sections: { title: string; items: Line[] }[];
  subtotal: number | null;
  tax: number | null;
  extraRows: [string, string][];
  total: number | null;
  depositPct: number | null;
  options: string[];
  weWill: string[];
  weWillNot: string[];
  terms: string;
  signed: { image: string | null; name: string | null; email: string | null; at: Date; ip: string | null } | null;
  footerId: string;
};

export async function proposalPdf(p: Proposal) {
  const project = await prisma.project.findUnique({
    where: { id: p.projectId },
    select: { name: true, address: true, clientCompany: { select: { name: true } }, salesperson: { select: { name: true, email: true, phone: true } } },
  });
  const rep = project?.salesperson ?? (p.createdById ? await prisma.user.findUnique({ where: { id: p.createdById }, select: { name: true, email: true, phone: true } }) : null);
  const work = await sections(p.estimateId);
  const alts = (p.alternates as Alternate[] | null) ?? [];
  const sel = (p.selectedAlternates as string[] | null) ?? [];
  const scope = p.scope as { weWill: string[]; weWillNot: string[] };
  const signed = p.status === "SIGNED" && p.signedAt;
  return renderProposal({
    title: p.title,
    date: p.createdAt,
    number: p.number,
    validUntil: p.validUntil,
    rep,
    jobName: project?.name ?? p.title,
    who: p.recipientName ?? project?.clientCompany?.name ?? null,
    address: project?.address ?? null,
    sections: work,
    subtotal: p.basePrice - p.taxAmount,
    tax: p.taxAmount,
    extraRows: signed ? alts.filter((a) => sel.includes(a.name)).map((a) => [`Option: ${a.name}`, `+ ${usd(a.price)}`]) : [],
    total: signed && p.acceptedTotal != null ? p.acceptedTotal : p.basePrice,
    depositPct: p.depositPct,
    options: signed ? [] : alts.map((a) => `${a.name}${a.description ? ` — ${a.description}` : ""}: + ${usd(a.price)}`),
    weWill: scope.weWill,
    weWillNot: scope.weWillNot,
    terms: p.terms,
    signed: signed ? { image: p.signatureImage, name: p.signerName, email: p.signerEmail, at: p.signedAt!, ip: p.signerIp } : null,
    footerId: p.number,
  });
}

/** Draws a proposal in the estimate-form layout (BTR's, with the company's name, letterhead and logo). */
export async function renderProposal(v: ProposalView) {
  const co = await getCompany();
  const rep = v.rep;
  const work = v.sections;
  const doc = await PDFDocument.create();
  doc.setTitle(safe(`${co.name} — ${v.title}`));
  doc.setProducer(co.productName);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let img: PDFImage | null = null;
  try {
    const own = await companyLogo(co);
    img = own ? await (own.type === "png" ? doc.embedPng(own.bytes) : doc.embedJpg(own.bytes)) : await doc.embedPng(logo());
  } catch {
    img = null;
  }
  const W = 612;
  const H = 792;
  const M = 30;
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - 50;

  const t = (s: string, x: number, yy: number, o: { size?: number; f?: PDFFont; c?: typeof INK; right?: boolean } = {}) => {
    const size = o.size ?? 9;
    const f = o.f ?? font;
    const str = safe(s);
    page.drawText(str, { x: o.right ? x - f.widthOfTextAtSize(str, size) : x, y: yy, size, font: f, color: o.c ?? INK });
  };
  const wrap = (s: string, f: PDFFont, size: number, max: number) => {
    const out: string[] = [];
    for (const para of safe(s).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(next, size) <= max || !line) line = next;
        else {
          out.push(line);
          line = word;
        }
      }
      out.push(line);
    }
    return out;
  };
  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - 40;
  };
  const room = (h: number) => {
    if (y - h < 50) newPage();
  };

  // ---------- header ----------
  if (img) {
    const w = 120;
    const h = (img.height / img.width) * w;
    page.drawImage(img, { x: M + 6, y: y - h - 4, width: w, height: h });
  }
  let hy = y;
  const hx = 170;
  t(co.name, hx, hy, { f: bold, size: 9 });
  for (const l of co.proposalAddress) t(l, hx, (hy -= 11));
  t(`Phone: ${co.officePhone}`, hx, (hy -= 11));
  if (rep) {
    hy -= 8;
    t("Company Representative", hx, (hy -= 11), { f: bold });
    t(rep.name, hx, (hy -= 11));
    if (rep.phone) t(`Phone: ${fmtPhone(rep.phone)}`, hx, (hy -= 11));
    t(rep.email, hx, (hy -= 11));
  }
  // title, right aligned, wrapped to two lines like the form
  const titleLines = wrap(v.title, font, 22, 230);
  let ty = y + 6;
  for (const l of titleLines) t(l, W - M, (ty -= 24), { size: 22, right: true });
  t(day(v.date), W - M, (ty -= 17), { size: 10, right: true });
  if (v.number) t(`Proposal ${v.number}`, W - M, (ty -= 11), { size: 8, right: true, c: SOFT });
  if (v.validUntil) t(`Valid until ${day(v.validUntil)}`, W - M, (ty -= 10), { size: 8, right: true, c: SOFT });
  y = Math.min(hy, ty) - 40;

  // ---------- customer + work box ----------
  const boxTop = y;
  const pad = 14;
  const who = v.who;
  const [street, ...rest] = (v.address ?? "").split(",").map((s) => s.trim());
  y -= 16;
  t(v.jobName, M + pad, y, { f: bold, size: 9 });
  if (who && who !== v.jobName) t(who, M + pad, (y -= 11));
  if (street) t(street, M + pad, (y -= 11));
  if (rest.length) t(rest.join(", "), M + pad, (y -= 11));
  y -= 20;
  const boxPages: { page: PDFPage; top: number; bottom: number }[] = [];
  let segTop = boxTop;
  const closeBox = (bottom: number) => boxPages.push({ page, top: segTop, bottom });
  for (const s of work) {
    if (y - 50 < 50) {
      closeBox(y);
      newPage();
      segTop = y + 10;
    }
    page.drawRectangle({ x: M + 1, y: y - 22, width: W - 2 * M - 2, height: 26, color: BAND });
    t(s.title, M + pad, y - 13, { f: bold, size: 11 });
    y -= 40;
    for (const it of s.items) {
      for (const l of wrap(it.text, font, 9, W - 2 * M - 60)) {
        if (y < 70) {
          closeBox(y + 6);
          newPage();
          segTop = y + 10;
        }
        t(l, M + pad + 12, y);
        y -= 12;
      }
      y -= 3;
      for (const sub of it.sub) {
        t(`- ${sub}`, M + pad + 24, y + 2, { size: 7.5, c: SOFT });
        y -= 9;
      }
      if (it.sub.length) y -= 3;
    }
  }
  if (!work.length) {
    t("Scope as described below.", M + pad + 12, y);
    y -= 14;
  }
  // subtotal at the bottom of the box (price before tax; TOTAL below matches the proposal price)
  room(40);
  y -= 4;
  page.drawLine({ start: { x: M + pad + 6, y }, end: { x: W - M - pad, y }, thickness: 1.2, color: INK });
  if (v.subtotal != null) t(usd(v.subtotal), W - M - pad, y - 18, { f: bold, size: 9, right: true });
  y -= 30;
  closeBox(y);
  for (const b of boxPages) b.page.drawRectangle({ x: M, y: b.bottom, width: W - 2 * M, height: b.top - b.bottom, borderColor: LINE, borderWidth: 1 });

  // ---------- tax and total ----------
  const tx = 330;
  const row = (label: string, value: string, big = false) => {
    const h = big ? 26 : 22;
    room(h + 4);
    page.drawRectangle({ x: tx, y: y - h, width: W - M - tx, height: h, color: big ? BAND : rgb(1, 1, 1), borderColor: LINE, borderWidth: 0.6 });
    t(label, tx + 12, y - h + (big ? 9 : 8), { size: big ? 11 : 8, c: big ? INK : SOFT });
    t(value, W - M - 12, y - h + (big ? 9 : 8), { size: big ? 11 : 8, right: true });
    y -= h;
  };
  y -= 10;
  if (v.tax != null) row("Tax", usd(v.tax));
  for (const [l, val] of v.extraRows) row(l, val);
  if (v.total != null) row("TOTAL", usd(v.total), true);
  if (v.depositPct && v.total != null) row(`Deposit due at signing (${v.depositPct}%)`, usd((v.total * v.depositPct) / 100));
  y -= 18;

  // ---------- options, scope, terms (only what's filled in) ----------
  const block = (title: string, lines: string[], size = 8.5) => {
    if (!lines.length) return;
    room(30);
    t(title, M, y, { f: bold, size: 10 });
    y -= 14;
    for (const l of lines)
      for (const w of wrap(l, font, size, W - 2 * M - 12)) {
        room(size + 4);
        t(w, M + 8, y, { size });
        y -= size + 3;
      }
    y -= 8;
  };
  block("Options (add to the total if selected)", v.options);
  block("We Will", v.weWill.map((s) => `• ${s}`));
  block("We Will Not", v.weWillNot.map((s) => `• ${s}`));
  if (v.terms.trim()) block("Terms", [v.terms], 7.5);

  // ---------- signatures ----------
  room(150);
  y -= 14;
  const sig = async (label: string, filled?: { image?: string | null; name?: string; date?: Date }) => {
    room(60);
    if (filled?.image) {
      try {
        const png = await doc.embedPng(Buffer.from(filled.image.split(",")[1], "base64"));
        const h = 34;
        page.drawImage(png, { x: M + 4, y: y + 2, width: Math.min((png.width / png.height) * h, 220), height: h });
      } catch {
        /* drawn signature unreadable — the typed record below still stands */
      }
    } else if (filled?.name) t(filled.name, M + 4, y + 6, { size: 12 });
    if (filled?.date) t(day(filled.date), 395, y + 6, { size: 10 });
    page.drawLine({ start: { x: M, y }, end: { x: 380, y }, thickness: 1.4, color: INK });
    page.drawLine({ start: { x: 395, y }, end: { x: 580, y }, thickness: 1.4, color: INK });
    t(label, M, y - 11);
    t("Date", 395, y - 11);
    y -= 58;
  };
  await sig("Company Authorized Signature");
  if (v.signed) {
    await sig("Customer Signature", { image: v.signed.image, name: v.signed.name ?? undefined, date: v.signed.at });
    t(`Signed electronically by ${v.signed.name} (${v.signed.email}) · ${v.signed.at.toISOString()} · IP ${v.signed.ip ?? "unknown"}`, M, y + 40, { size: 6.5, c: SOFT });
    await sig("Customer Signature");
  } else {
    await sig("Customer Signature");
    await sig("Customer Signature");
  }

  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    if (pages.length > 1) pg.drawText(safe(`${co.name} · ${v.footerId} · Page ${i + 1} of ${pages.length}`), { x: M, y: 20, size: 7, font, color: SOFT });
  });
  return doc.save();
}

function fmtPhone(s: string) {
  const d = s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : s;
}
