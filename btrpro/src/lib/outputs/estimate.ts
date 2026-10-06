// Estimate outputs (BUILD_PROMPT §9): AccuLynx copy list, material order CSV, BTR estimate PDF, internal takeoff PDF.
import { prisma } from "@/lib/db";
import { totalsFor } from "@/lib/estimates/service";
import { rulesForEstimate } from "@/lib/estimates/rules";
import { sheetDateStatus } from "@/lib/sheets/date-status";
import { READINESS_LABEL } from "@/lib/projects/readiness";
import { MEASUREMENT_BY_KEY } from "@/lib/docs/measurements";
import { getCompany, type Company, botName } from "@/lib/company-profile";
import { AMBER, GREEN, PdfWriter, RED } from "@/lib/pdf/writer";
import { rgb } from "pdf-lib";

export async function loadBundle(estimateId: string) {
  const e = await prisma.estimate.findUniqueOrThrow({
    where: { id: estimateId },
    include: {
      project: { include: { clientCompany: true, contacts: { where: { isPrimary: true }, include: { contact: true } } } },
      lines: { orderBy: [{ section: "asc" }, { sortOrder: "asc" }], include: { priceItem: { include: { sheet: true } } } },
      laborLines: { orderBy: { sortOrder: "asc" } },
      openItems: { where: { resolved: false } },
      scopeItems: { orderBy: { sortOrder: "asc" } },
    },
  });
  const [totals, sheets, measurements] = await Promise.all([
    totalsFor(estimateId),
    prisma.priceSheet.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
    prisma.measurement.findMany({ where: { projectId: e.projectId, status: { in: ["CONFIRMED", "USER_ENTERED"] } }, include: { sourceDoc: true } }),
  ]);
  return { e, totals, sheets, measurements };
}
type Bundle = Awaited<ReturnType<typeof loadBundle>>;

const MATERIAL = (s: string) => s.startsWith("MATERIAL");
const qty = (n: number | null) => (n == null ? "" : String(Math.round(n * 100) / 100));
const usd = (n: number | null) => (n == null ? "" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const STATUS: Record<string, string> = {
  VERIFIED: "Verified",
  SHEET_STALE: "Sheet stale",
  SHEET_EXPIRED: "SHEET EXPIRED",
  CALL_FOR_PRICE: "CALL - get quote",
  MISSING_ITEM: "MISSING item",
  MISSING_PRICE: "MISSING price",
  PLACEHOLDER: "PLACEHOLDER - not for final bid",
  ASSUMPTION_APPROVED: "Approved assumption",
  PENDING_AI: `${botName()} suggestion - not accepted`,
  MISSING: "MISSING",
};

/** Copy-paste material list: item, quantity, unit only — no codes, no metadata (CLAUDE.md §8). */
export function materialListText(b: Bundle) {
  const rows = b.e.lines.filter((l) => MATERIAL(l.section) && l.quantity != null && l.sourceStatus !== "PENDING_AI");
  return {
    text: rows.map((l) => `${l.itemName}\t${qty(l.quantity)}\t${l.unit ?? ""}`).join("\n"),
    skipped: b.e.lines.filter((l) => MATERIAL(l.section) && (l.quantity == null || l.sourceStatus === "PENDING_AI")).map((l) => l.itemName),
  };
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export function orderCsv(b: Bundle) {
  const rows = [["Item #", "Description", "Qty", "UOM", "Sheet", "Note"]];
  for (const l of b.e.lines.filter((x) => MATERIAL(x.section) && x.sourceStatus !== "PENDING_AI"))
    rows.push([l.supplierItemNumber ?? "MISSING", l.itemName, qty(l.quantity) || "MISSING", l.unit ?? "", l.priceItem?.sheet.code ?? "", [l.note, l.substitution ? "SUBSTITUTION" : ""].filter(Boolean).join(" ")]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function header(co: Company, b: Bundle, title: string) {
  return (w: PdfWriter) => {
    w.text(`${co.name.toUpperCase()}  ·  ${co.address}  ·  ${co.phone}  ·  ${co.email}`, { size: 7, color: rgb(0.4, 0.4, 0.45), gap: 0 });
    w.text(`${title} — ${b.e.project.name} — ${b.e.name}`, { size: 7, color: rgb(0.4, 0.4, 0.45), gap: 6 });
  };
}

function projectBlock(w: PdfWriter, b: Bundle) {
  const p = b.e.project;
  const primary = p.contacts[0]?.contact;
  w.text(p.name, { size: 16, bold: true, gap: 2 });
  w.text(
    [
      p.address,
      p.clientCompany?.name ?? (primary ? `${primary.firstName} ${primary.lastName}` : null),
      `${b.e.name} (${b.e.scopeType.replace("_", " ").toLowerCase()})`,
      `Prepared ${new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago" })}`,
      p.bidDueDate && `Bid due ${p.bidDueDate.toISOString().slice(0, 10)}`,
    ]
      .filter(Boolean)
      .join("  ·  "),
    { size: 9, gap: 4 },
  );
  const r = p.readiness;
  w.stamp(READINESS_LABEL[r].toUpperCase(), r === "BID_READY" ? GREEN : r === "BUDGET" ? AMBER : RED);
}

function sheetFootnote(co: Company, w: PdfWriter, b: Bundle) {
  w.heading("Price sheets");
  for (const s of b.sheets) {
    if (!s.isLoaded) {
      w.text(`${s.code} ${s.name}: not loaded — items from it are MISSING.`, { size: 7 });
      continue;
    }
    const st = sheetDateStatus(s);
    w.text(`${s.code} ${s.name}: effective ${s.effectiveDate?.toISOString().slice(0, 10)}, expires ${s.expirationDate?.toISOString().slice(0, 10)} (${st.status})${s.warning ? ` — ${s.warning}` : ""}`, { size: 7, gap: 0 });
  }
  w.text(`${co.supplier.name}: ${co.supplier.surchargeNote}`, { size: 7, gap: 4 });
}

export async function estimatePdf(b: Bundle) {
  const co = await getCompany();
  const w = await PdfWriter.create({ title: `${b.e.project.name} ${b.e.name}`, footer: `${co.name} estimate · ${b.e.project.name} · ${b.e.name}`, header: header(co, b, "Estimate") });
  projectBlock(w, b);
  const cols = [
    { header: "Item", width: 34 },
    { header: "Supplier Material #", width: 14 },
    { header: "Quantity", width: 9, align: "right" as const },
    { header: "Unit", width: 6 },
    { header: "Unit Cost", width: 10, align: "right" as const },
    { header: "Total", width: 11, align: "right" as const },
    { header: "Source/Status", width: 16 },
  ];
  const sections: [string, string][] = [
    ["MATERIAL_ROOFING", "Materials — roofing"],
    ["MATERIAL_DECK", "Materials — deck"],
    ["MATERIAL_SIDING", "Materials — siding"],
    ["GENERAL_CONDITIONS", "General conditions"],
  ];
  for (const [key, label] of sections) {
    const lines = b.e.lines.filter((l) => l.section === key);
    if (!lines.length) continue;
    w.heading(label);
    w.table(
      cols,
      lines.map((l) => [
        `${l.itemName}${l.substitution ? " [SUBSTITUTION]" : ""}${l.note ? ` — ${l.note}` : ""}`,
        l.supplierItemNumber ?? (l.sourceStatus.startsWith("MISSING") ? "MISSING" : ""),
        qty(l.quantity) || "MISSING",
        l.unit ?? "",
        l.sourceStatus === "CALL_FOR_PRICE" ? "CALL" : usd(l.unitCost),
        usd(l.total),
        `${STATUS[l.sourceStatus] ?? l.sourceStatus}${l.priceItem ? ` (${l.priceItem.sheet.code})` : ""}`,
      ]),
      { shade: (i) => (lines[i].sourceStatus.startsWith("MISSING") || lines[i].sourceStatus === "CALL_FOR_PRICE" ? rgb(1, 0.94, 0.94) : null) },
    );
  }
  w.heading("Open items");
  if (b.e.openItems.length) for (const o of b.e.openItems) w.text(`• ${o.text}${o.owner ? ` (${o.owner})` : ""}`, { size: 9, gap: 0 });
  else w.text("None.", { size: 9 });
  w.y -= 4;

  w.heading("Labor");
  if (b.e.laborLines.length)
    w.table(
      [
        { header: "Task", width: 30 },
        { header: "Qty", width: 10, align: "right" },
        { header: "Crew", width: 6, align: "right" },
        { header: "Rate", width: 12, align: "right" },
        { header: "Hours", width: 8, align: "right" },
        { header: "$/hr", width: 8, align: "right" },
        { header: "Burden", width: 8, align: "right" },
        { header: "Total", width: 10, align: "right" },
        { header: "Status", width: 12 },
      ],
      b.e.laborLines.map((l) => [
        l.task,
        `${qty(l.quantity)} ${l.quantityUnit ?? ""}`,
        l.crewSize?.toString() ?? "",
        l.productionRate != null ? `${l.productionRate} ${l.productionUnit ?? ""}/hr` : "MISSING",
        qty(l.laborHours),
        usd(l.hourlyRate),
        l.burdenPct != null ? `${l.burdenPct}%` : "",
        usd(l.total),
        STATUS[l.sourceStatus] ?? l.sourceStatus,
      ]),
    );
  else w.text("No labor lines — MISSING.", { size: 9 });

  w.heading("Totals");
  const t = b.totals;
  w.table(
    [
      { header: "", width: 60 },
      { header: "", width: 40, align: "right" },
    ],
    [
      ["Materials", usd(t.materials)],
      ["General conditions", usd(t.generalConditions)],
      ["Labor", usd(t.labor)],
      [`Contingency${b.e.contingencyPct ? ` (${b.e.contingencyPct}%)` : ""}`, usd(t.contingency)],
      [t.incomplete ? "GRAND TOTAL — INCOMPLETE (lines without a number are excluded)" : "Grand total", usd(t.grandTotal)],
    ],
  );

  w.heading("Scope");
  for (const [type, label] of [
    ["WE_WILL", "We Will"],
    ["WE_WILL_NOT", "We Will Not"],
  ] as const) {
    const items = b.e.scopeItems.filter((s) => s.type === type);
    w.text(label, { bold: true, size: 10, gap: 1 });
    if (items.length) for (const s of items) w.text(`• ${s.text}`, { size: 9, gap: 0 });
    else w.text("—", { size: 9 });
    w.y -= 4;
  }
  sheetFootnote(co, w, b);
  return w.save();
}

/** Internal QA copy: every formula, its inputs, and the source of every measurement. */
export async function takeoffPdf(b: Bundle) {
  const co = await getCompany();
  const w = await PdfWriter.create({ title: `${b.e.project.name} takeoff`, footer: `${co.name} internal takeoff · ${b.e.project.name} · ${b.e.name}`, header: header(co, b, "INTERNAL TAKEOFF — not for customer") });
  projectBlock(w, b);
  w.heading("Measurements used (confirmed / entered only)");
  w.table(
    [
      { header: "Measurement", width: 34 },
      { header: "Value", width: 14, align: "right" },
      { header: "Source", width: 52 },
    ],
    b.measurements.map((m) => [
      `${MEASUREMENT_BY_KEY.get(m.key)?.label ?? m.key}${m.facet ? ` (${m.facet})` : ""}`,
      `${m.value} ${m.unit ?? ""}`,
      `${m.sourceDoc ? `${m.sourceDoc.fileName} p.${m.sourcePage}` : ""} ${m.note ?? ""} · ${m.status === "USER_ENTERED" ? "entered" : "confirmed"} by ${m.confirmedBy ?? "?"}`,
    ]),
  );
  const waste = (b.e.wastePctBySection as Record<string, { pct: number | null; approved: boolean; basis: string }>) ?? {};
  w.heading("Waste");
  for (const [k, v] of Object.entries(waste)) w.text(`${k}: ${v.pct ?? "—"}% — ${v.approved ? "approved" : "NOT approved"} (${v.basis})`, { size: 9, gap: 0 });
  w.y -= 4;
  w.heading("Lines and formulas");
  for (const l of b.e.lines) {
    w.text(`${l.itemName} [${l.supplierItemNumber ?? "MISSING"}]${l.ruleId ? ` ${l.ruleId}` : ""} — ${STATUS[l.sourceStatus] ?? l.sourceStatus}`, { size: 9, bold: true, gap: 0 });
    w.text(l.formula ?? "Entered by hand", { size: 8, gap: 0 });
    const inputs = (l.formulaInputs as Record<string, unknown> | null) ?? {};
    const srcs = Object.entries(inputs)
      .filter(([k]) => k.endsWith("__source"))
      .map(([k, v]) => `${k.replace("__source", "")}: ${v}`);
    if (srcs.length) w.text(`Sources — ${srcs.join("; ")}`, { size: 7, gap: 0 });
    if (l.substitutionNote) w.text(l.substitutionNote, { size: 7, gap: 0 });
    w.y -= 4;
  }
  const rules = await rulesForEstimate(b.e.id, null);
  w.heading("Company rules");
  for (const r of rules) w.text(`${r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "INFO"}  ${r.id}  ${r.message}`, { size: 8, gap: 0 });
  sheetFootnote(co, w, b);
  return w.save();
}
