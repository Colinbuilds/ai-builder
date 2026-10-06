import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { round } from "@/lib/calc/core";
import { getCompany } from "@/lib/company-profile";
import { totalsFor } from "@/lib/estimates/service";
import { getSettings } from "@/lib/settings";
import { proposalPrice } from "@/lib/proposals/price";
import { addChangeOrder, decideChangeOrder, type CostActor } from "@/lib/costing/service";
import { saveUpload } from "@/lib/storage";
import { emailConfigured, sendEmail } from "@/lib/email/send";
import { PdfWriter } from "@/lib/pdf/writer";
import { splitCsv } from "@/lib/sheets/parse";

export class ChangeOrderError extends Error {}
export const changeOrderUrl = (token: string) => `${process.env.APP_URL ?? ""}/co/${token}`;
const act = (projectId: string, userId: string | null, text: string) => prisma.projectActivity.create({ data: { projectId, userId, kind: "change_order", text } });

/**
 * Prices a change order from a complete estimate on the job — the same sheets, rules, and formulas as any
 * estimate — then (cost + tax on materials) × (1 + markup). The estimate can't be the job's cost baseline.
 */
export async function priceFromEstimate(projectId: string, estimateId: string, markupPct: number | null) {
  const [p, e, s] = await Promise.all([prisma.project.findUniqueOrThrow({ where: { id: projectId } }), prisma.estimate.findUniqueOrThrow({ where: { id: estimateId } }), getSettings()]);
  if (e.projectId !== projectId) throw new ChangeOrderError("That estimate is on a different job.");
  if ((p.costBaseline as { estimateId?: string } | null)?.estimateId === estimateId) throw new ChangeOrderError("That's the job's sold estimate. Price the change as its own estimate (e.g. \"CO-2 extra layer\").");
  const t = await totalsFor(estimateId);
  if (t.incomplete) throw new ChangeOrderError("That estimate is INCOMPLETE (some lines or labor have no number).");
  const markup = markupPct ?? s.markupPct;
  if (markup == null) throw new ChangeOrderError("Enter a markup % (or set the company default).");
  const price = proposalPrice({ cost: t.grandTotal, materials: t.materials, taxExempt: p.isTaxExempt, taxPct: s.salesTaxPct, markupPct: markup });
  return { costImpact: round(t.grandTotal + price.taxAmount, 2), amount: price.basePrice, formula: `${e.name}: ${price.breakdown}` };
}

export async function createChangeOrderFromEstimate(projectId: string, input: { estimateId: string; markupPct: number | null; description: string; kind: "CHANGE_ORDER" | "SUPPLEMENT" }, actor: CostActor) {
  const priced = await priceFromEstimate(projectId, input.estimateId, input.markupPct);
  const co = await addChangeOrder(projectId, { kind: input.kind, description: input.description, amount: priced.amount, costImpact: priced.costImpact, source: "Priced from estimate" }, actor);
  return prisma.changeOrder.update({ where: { id: co.id }, data: { estimateId: input.estimateId, priceFormula: priced.formula } });
}

export async function sendChangeOrder(id: string, to: { name: string | null; email: string | null }, actor: CostActor) {
  const company = await getCompany();
  if (actor.role === "VIEWER") throw new ChangeOrderError("Viewers can't send change orders.");
  const co = await prisma.changeOrder.findUniqueOrThrow({ where: { id }, include: { project: true } });
  if (co.status !== "PENDING") throw new ChangeOrderError(`${co.number} is already ${co.status.toLowerCase()}.`);
  if (co.kind === "CREDIT") throw new ChangeOrderError("Credits don't need the customer's signature.");
  const token = co.token ?? randomBytes(18).toString("base64url");
  await prisma.changeOrder.update({ where: { id }, data: { token, sentAt: new Date(), sentTo: to.email } });
  let emailed = false;
  if (to.email && emailConfigured())
    await sendEmail({
      to: to.email,
      subject: `${company.name} change order ${co.number} — ${co.project.name}`,
      text: `${to.name ?? ""}\n\nPlease review and sign change order ${co.number} for ${co.project.name}: ${co.description} ($${co.amount.toFixed(2)}).\n\n${changeOrderUrl(token)}\n\n${company.name} · ${company.phone}`,
    }).then(
      () => (emailed = true),
      (e) => console.error("CO email failed", e),
    );
  await act(co.projectId, actor.id, `${actor.name} sent ${co.number} for the customer's signature${emailed ? ` to ${to.email}` : ""}`);
  return { url: changeOrderUrl(token), emailed };
}

export async function getChangeOrderByToken(token: string) {
  const co = await prisma.changeOrder.findFirst({ where: { token }, include: { project: { select: { name: true, address: true, contractAmount: true } } } });
  if (!co || !co.sentAt) return null;
  return co;
}

export async function signChangeOrder(token: string, s: { name: string; email: string; consent: boolean; signatureImage: string | null; ip: string | null }) {
  const company = await getCompany();
  const co = await getChangeOrderByToken(token);
  if (!co) throw new ChangeOrderError("This change order isn't available.");
  if (co.status !== "PENDING") throw new ChangeOrderError(`This change order was already ${co.status.toLowerCase()}.`);
  if (!s.name.trim() || !s.email.trim()) throw new ChangeOrderError("Enter your name and email.");
  if (!s.consent) throw new ChangeOrderError("Check the box to agree to sign electronically.");
  if (s.signatureImage && (!s.signatureImage.startsWith("data:image/png;base64,") || s.signatureImage.length > 400_000)) throw new ChangeOrderError("The signature image didn't come through. Clear it and sign again.");
  const now = new Date();
  const w = await PdfWriter.create({ title: `Change order ${co.number}`, footer: `${company.name} · ${company.phone}` });
  w.text(`${company.name.toUpperCase()}  ·  ${company.address}  ·  ${company.phone}`, { size: 8, gap: 8 });
  w.heading(`${co.kind === "SUPPLEMENT" ? "Supplement" : "Change order"} ${co.number}`);
  w.text(`Job: ${co.project.name}${co.project.address ? ` · ${co.project.address}` : ""}`, { size: 10, gap: 4 });
  w.text(co.description, { size: 11, gap: 4 });
  w.text(`Amount: $${co.amount.toFixed(2)} added to the contract.`, { size: 11, bold: true, gap: 8 });
  if (s.signatureImage) {
    const png = await w.doc.embedPng(Buffer.from(s.signatureImage.split(",")[1], "base64"));
    const h = 50;
    w.page.drawImage(png, { x: w.margin, y: w.y - h, width: Math.min((png.width / png.height) * h, 250), height: h });
    w.y -= h + 6;
  }
  w.text(`Signed electronically by ${s.name.trim()} <${s.email.trim()}> on ${now.toISOString()} from ${s.ip ?? "unknown IP"}.`, { size: 9, gap: 2 });
  const pdf = await w.save();
  const fileUrl = await saveUpload(pdf, `${co.number}-signed.pdf`, `projects/${co.projectId}/change-orders`);
  const doc = await prisma.document.create({ data: { projectId: co.projectId, type: "OTHER", fileName: `${co.number} signed change order.pdf`, fileUrl, source: "UPLOAD", contentType: "application/pdf", sizeBytes: pdf.length } });
  await prisma.changeOrder.update({ where: { id: co.id }, data: { signerName: s.name.trim(), signerEmail: s.email.trim(), signedAt: now, signerIp: s.ip, signatureImage: s.signatureImage, signedDocumentId: doc.id } });
  await decideChangeOrder(co.id, "APPROVED", { id: null, name: `${s.name.trim()} (customer e-signature)`, role: "SYSTEM" });
  return prisma.changeOrder.findUniqueOrThrow({ where: { id: co.id } });
}

export async function declineChangeOrder(token: string, reason: string) {
  const co = await getChangeOrderByToken(token);
  if (!co) throw new ChangeOrderError("This change order isn't available.");
  if (co.status !== "PENDING") throw new ChangeOrderError(`This change order was already ${co.status.toLowerCase()}.`);
  await prisma.changeOrder.update({ where: { id: co.id }, data: { declineReason: reason.trim() || null } });
  await decideChangeOrder(co.id, "REJECTED", { id: null, name: "Customer (declined online)", role: "SYSTEM" });
}

/**
 * Imports change orders from a Procore or Buildertrend CSV export. Columns are matched by name; rows keep
 * their source number so re-importing doesn't duplicate. Only "approved"/"executed" rows count as approved.
 */
export function parseChangeOrderCsv(csv: string) {
  const lines = csv.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim());
  const head = splitCsv(lines[0] ?? "").map((h) => h.toLowerCase().trim());
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const iNum = col("#", "number", "co #", "change order #", "change order number", "id");
  const iTitle = col("title", "name", "change order", "subject");
  const iDesc = col("description", "details", "scope");
  const iAmt = col("amount", "grand total", "total", "price", "owner price", "builder price", "total amount");
  const iStatus = col("status", "approval status");
  const problems: string[] = [];
  if (iAmt < 0 || (iTitle < 0 && iDesc < 0)) return { rows: [], problems: ["Couldn't find Amount and Title/Description columns."] };
  const rows = lines.slice(1).flatMap((l, n) => {
    const c = splitCsv(l);
    const raw = (c[iAmt] ?? "").replace(/[$,\s]/g, "");
    const neg = /^\(.*\)$/.test(raw) || raw.startsWith("-");
    const amount = Number(raw.replace(/[()-]/g, ""));
    const title = [iTitle >= 0 ? c[iTitle] : "", iDesc >= 0 ? c[iDesc] : ""].filter(Boolean).join(" — ");
    if (!raw || !Number.isFinite(amount)) {
      problems.push(`Row ${n + 2}: "${title}" has no amount. Skipped.`);
      return [];
    }
    const status = (iStatus >= 0 ? c[iStatus] : "").toLowerCase();
    return [{ number: iNum >= 0 ? c[iNum] || null : null, description: title || "(no title)", amount: Math.abs(amount), credit: neg, approved: /approved|executed|signed|accepted/.test(status), rejected: /rejected|declined|void/.test(status) }];
  });
  return { rows, problems };
}

export async function importChangeOrders(projectId: string, csv: string, source: "Procore" | "Buildertrend", actor: CostActor) {
  const { rows, problems } = parseChangeOrderCsv(csv);
  if (!rows.length) throw new ChangeOrderError(problems[0] ?? "No change orders found.");
  let created = 0;
  let skipped = 0;
  for (const r of rows.filter((x) => !x.rejected)) {
    const ref = r.number ? `${source}:${r.number}` : null;
    if (ref && (await prisma.changeOrder.findFirst({ where: { projectId, externalRef: ref } }))) {
      skipped++;
      continue;
    }
    const co = await addChangeOrder(projectId, { kind: r.credit ? "CREDIT" : "CHANGE_ORDER", description: r.description, amount: r.amount, costImpact: null, source: `${source} export${r.number ? ` #${r.number}` : ""}` }, actor);
    await prisma.changeOrder.update({ where: { id: co.id }, data: { externalRef: ref } });
    if (r.approved) await decideChangeOrder(co.id, "APPROVED", { ...actor, name: `${actor.name} (approved in ${source})` });
    created++;
  }
  return { created, skipped, problems };
}
