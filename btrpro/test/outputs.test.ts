import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import { addManualMeasurement } from "@/lib/docs/confirm";
import { addLine, createEstimate, runTakeoff, saveTakeoff } from "@/lib/estimates/service";
import { addLaborLine } from "@/lib/estimates/labor";
import { materialListText, estimatePdf, loadBundle, orderCsv, takeoffPdf } from "@/lib/outputs/estimate";
import { proposalPrice, acceptedTotal } from "@/lib/proposals/price";
import { proposalPdf } from "@/lib/proposals/pdf";
import { createProposal, declineProposal, getByToken, sendProposal, signProposal } from "@/lib/proposals/service";
import { saveSettings } from "@/lib/settings";
import { safe } from "@/lib/pdf/writer";

process.env.UPLOAD_DIR = "prisma/test-uploads";
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T17:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
  return prisma.$disconnect();
});
const admin = async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  return { id: u.id, name: u.name, role: "ADMIN" };
};

async function finishedEstimate() {
  const a = await admin();
  const p = await createProject(
    { name: "TEST_ONLY Outputs", market: "RESIDENTIAL", scopes: ["STEEP"], address: "9 Test Ave", isPublic: false, isTaxExempt: false },
    a,
    { firstName: "Pat", lastName: "Homeowner", email: "pat@test.local", phone: "4025550199" },
  );
  for (const [key, value] of Object.entries({ roof_total_sf: 3240, eaves_lf: 180, rakes_lf: 120, ridges_lf: 40, hips_lf: 95 }))
    await addManualMeasurement(p.id, { key, value, facet: null, source: "TEST_ONLY" }, a);
  const e = await createEstimate(p.id, "STEEP", a);
  await saveTakeoff(e.id, "steep", {
    shingle: { itemNumber: "02MLVIA3AB" },
    starter: { itemNumber: "04MLWSSAB" },
    hipRidge: { itemNumber: "04MLHR12AB" },
    ridgeVent: { itemNumber: null },
    underlayment: { itemNumber: null },
    iceWater: { itemNumber: null, rows: [] },
    dripEdge: { itemNumber: null },
    stepFlashing: { itemNumber: null, unit: "BX" },
    pipeBoot: { itemNumber: null },
  });
  await runTakeoff(e.id, "steep", a);
  return { a, p, e };
}

describe("estimate outputs", () => {
  it("AccuLynx copy is item / qty / unit only and skips lines without a quantity", async () => {
    const { e } = await finishedEstimate();
    const { text, skipped } = materialListText(await loadBundle(e.id));
    expect(text.split("\n")).toContain('1.25" Coil Nail\t3\tBX');
    expect(text).not.toMatch(/0150080011/); // no item numbers
    expect(skipped).toContain("Ridge vent");
  });

  it("order CSV carries item #, qty, UOM, sheet, and the order note", async () => {
    const { e } = await finishedEstimate();
    const csv = orderCsv(await loadBundle(e.id));
    expect(csv.split("\r\n")[0]).toBe("Item #,Description,Qty,UOM,Sheet,Note");
    expect(csv).toContain("02MLVIA3AB,Vista AR 252 3/SQ,34.33,SQ,SS,Order 103 BD.");
    expect(csv).toMatch(/MISSING,Ridge vent,MISSING/);
  });

  it("renders the estimate and takeoff PDFs", async () => {
    const { e } = await finishedEstimate();
    const b = await loadBundle(e.id);
    const pdf = Buffer.from(await estimatePdf(b));
    const tk = Buffer.from(await takeoffPdf(b));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(tk.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(3000);
  });

  it("PDF text is made safe for the standard fonts", () => {
    expect(safe("ceil(40 ÷ 25) → 2 ✔ ≤")).toBe("ceil(40 ÷ 25) -> 2 OK <=");
    expect(safe("emoji 🙂")).toBe("emoji ?");
  });
});

describe("proposal pricing", () => {
  it("adds tax on materials (not on tax-exempt jobs), then markup", () => {
    expect(proposalPrice({ cost: 10000, materials: 6000, taxExempt: false, taxPct: 7, markupPct: 25 })).toMatchObject({ taxAmount: 420, basePrice: 13025 });
    expect(proposalPrice({ cost: 10000, materials: 6000, taxExempt: true, taxPct: 7, markupPct: 25 })).toMatchObject({ taxAmount: 0, basePrice: 12500 });
    expect(acceptedTotal(12500, [{ name: "Class 4", description: "", price: 1800 }, { name: "Gutters", description: "", price: 900 }], ["Gutters"])).toBe(13400);
  });
});

describe("proposals and e-signature", () => {
  it("won't make a proposal from an INCOMPLETE estimate or without terms/markup", async () => {
    const { a, e } = await finishedEstimate();
    await expect(createProposal(e.id, { markupPct: 20, alternates: [] }, a)).rejects.toThrow(/INCOMPLETE/);
  });

  it("sign-off sets the contract and moves the job to Sold; the signed PDF is filed on the job", async () => {
    const { a, p, e } = await finishedEstimate();
    // make the estimate complete: drop missing lines, add labor
    await prisma.estimateLine.deleteMany({ where: { estimateId: e.id, total: null } });
    await addLaborLine(e.id, { task: "Install", quantity: 32.4, quantityUnit: "SQ", quantitySource: "roof", productionRate: 1, hourlyRate: 10, burdenPct: 0, rateSource: "TEST_ONLY" }, a);
    await addLine(e.id, { section: "GENERAL_CONDITIONS", itemName: "Dumpster", quantity: 1, unit: "EA", unitCost: 400, source: "TEST_ONLY quote" }, a);
    await saveSettings({ proposalTerms: "TEST_ONLY terms", depositPct: 30, proposalValidDays: 30, markupPct: null }, a);
    await expect(createProposal(e.id, { markupPct: 25, alternates: [], acknowledgeNotReady: true }, a)).rejects.toThrow(/scope of work/);
    await prisma.scopeItem.create({ data: { estimateId: e.id, type: "WE_WILL", text: "TEST_ONLY tear off and reroof" } });
    await expect(createProposal(e.id, { markupPct: null, alternates: [], acknowledgeNotReady: true }, a)).rejects.toThrow(/markup/);
    await expect(createProposal(e.id, { markupPct: 25, alternates: [] }, a)).rejects.toThrow(/NOT READY/);
    const prop = await createProposal(e.id, { markupPct: 25, alternates: [{ name: "Gutters", description: "5\" seamless", price: 900 }], acknowledgeNotReady: true }, a);
    expect(prop.recipientEmail).toBe("pat@test.local");
    // customer PDF in BTR's estimate-form layout: sections of items (no unit costs), tax, TOTAL, signature lines
    await prisma.estimateLine.updateMany({ where: { estimateId: e.id, section: "GENERAL_CONDITIONS" }, data: { note: "- TEST_ONLY roller\n- rags\ninternal: not shown" } });
    const pdfBytes = await proposalPdf(prop);
    if (process.env.PROPOSAL_PDF_OUT) (await import("node:fs")).writeFileSync(process.env.PROPOSAL_PDF_OUT, pdfBytes);
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(pdfBytes)).getPageCount()).toBeGreaterThanOrEqual(1);
    expect(await getByToken(prop.token)).toBeNull(); // drafts aren't visible to the customer
    await sendProposal(prop.id, { name: "Pat Homeowner", email: "pat@test.local" }, a);
    await expect(signProposal(prop.token, { name: "Pat Homeowner", email: "pat@test.local", consent: false, selected: [], signatureImage: null, ip: null, agent: null })).rejects.toThrow(/electronically/);
    const signed = await signProposal(prop.token, { name: "Pat Homeowner", email: "pat@test.local", consent: true, selected: ["Gutters", "Bogus"], signatureImage: null, ip: "203.0.113.9", agent: "TEST" });
    expect(signed.acceptedTotal).toBe(prop.basePrice + 900);
    expect(signed.selectedAlternates).toEqual(["Gutters"]);
    const job = await prisma.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(job).toMatchObject({ status: "SOLD", contractAmount: prop.basePrice + 900 });
    expect(job.contractSignedAt).not.toBeNull();
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: signed.signedDocumentId! } });
    expect(doc.fileName).toMatch(/signed proposal/);
    await expect(declineProposal(prop.token, "x")).rejects.toThrow(/signed/);
  });

  it("expired proposals can't be signed", async () => {
    const { a, e } = await finishedEstimate();
    await prisma.estimateLine.deleteMany({ where: { estimateId: e.id, total: null } });
    await addLaborLine(e.id, { task: "Install", quantity: 1, quantityUnit: "EA", quantitySource: "x", productionRate: 1, hourlyRate: 10, burdenPct: 0, rateSource: "TEST_ONLY" }, a);
    await saveSettings({ proposalTerms: "TEST_ONLY terms" }, a);
    await prisma.scopeItem.create({ data: { estimateId: e.id, type: "WE_WILL", text: "TEST_ONLY reroof" } });
    const prop = await createProposal(e.id, { markupPct: 20, alternates: [], acknowledgeNotReady: true }, a);
    await sendProposal(prop.id, { name: null, email: null }, a);
    await prisma.proposal.update({ where: { id: prop.id }, data: { validUntil: new Date("2026-09-01") } });
    await expect(signProposal(prop.token, { name: "Pat", email: "p@test.local", consent: true, selected: [], signatureImage: null, ip: null, agent: null })).rejects.toThrow(/expired/);
  });
});
