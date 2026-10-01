// TEST_ONLY synthetic photos and data; the AI is faked.
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { setAiClientForTests } from "@/lib/ai/claude";
import { createProject } from "@/lib/projects/service";
import { cleanPage, detectPaper, zoomSections } from "@/lib/photos/document";
import { approveReceipt, loadReceipt, recropAndReread, scanReceipt, setLinePrices } from "@/lib/receipts/service";
import type { Receipt } from "@/lib/receipts/check";
import { receiptPricing } from "@/lib/receipts/pricing";

afterAll(() => {
  setAiClientForTests(null);
  return prisma.$disconnect();
});

/** A dark "car seat" photo with a white receipt strip at a known spot, with some dark "text" on it. */
async function fakePhoto() {
  const W = 1200, H = 1600;
  const paper = await sharp({ create: { width: 420, height: 1300, channels: 3, background: "#f4f4f2" } })
    .composite(Array.from({ length: 30 }, (_, i) => ({ input: { create: { width: 300, height: 10, channels: 3 as const, background: "#222" } }, left: 50, top: 60 + i * 40 })))
    .png()
    .toBuffer();
  return new Uint8Array(await sharp({ create: { width: W, height: H, channels: 3, background: "#2b2723" } }).composite([{ input: paper, left: 380, top: 150 }]).jpeg().toBuffer());
}

describe("finding and cleaning up the paper", () => {
  it("crops to the receipt strip and makes zoomed sections of a tall page", async () => {
    const photo = await fakePhoto();
    const c = (await detectPaper(photo))!;
    // the strip is x 380–800 of 1200, y 150–1450 of 1600
    expect(c.x).toBeGreaterThan(0.28);
    expect(c.x).toBeLessThan(0.33);
    expect(c.x + c.w).toBeGreaterThan(0.66);
    expect(c.x + c.w).toBeLessThan(0.7);
    expect(c.y).toBeLessThan(0.11);
    expect(c.y + c.h).toBeGreaterThan(0.89);
    const page = await cleanPage(photo, { crop: c, rotate: 0 });
    expect(page.info.width).toBeLessThan(500);
    const tiles = await zoomSections(page.data, page.info.width, page.info.height);
    expect(tiles.length).toBeGreaterThanOrEqual(2);
    // a photo that's all paper is left alone
    expect(await detectPaper(new Uint8Array(await sharp({ create: { width: 400, height: 600, channels: 3, background: "#fafafa" } }).jpeg().toBuffer()))).toBeNull();
  });
});

const ticket = (over: Partial<Receipt> = {}): Receipt => ({
  documentType: "DELIVERY_TICKET",
  vendor: "ABC Supply",
  branch: "640",
  invoiceNumber: null,
  orderNumber: null,
  poNumber: null,
  jobName: null,
  shipToName: "BTR Contracting-Shop",
  shipToAddress: "2755 River Rd Waterloo, NE",
  date: "2026-09-28",
  lines: [],
  subtotal: null,
  tax: null,
  total: null,
  notes: [],
  ...over,
});

describe("delivery tickets (no prices printed)", () => {
  it("prices from the sheet when the unit matches, takes typed prices for the rest, and files no cost", async () => {
    const a = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const actor = { id: a.id, name: a.name, role: "ADMIN" as const };
    const item = await prisma.priceItem.findFirstOrThrow({ where: { unitPrice: { not: null }, sheet: { isActive: true, companyId: null } } });
    const job = await createProject({ name: `TEST_ONLY Wylie Clangx ${Date.now()}`, scopes: ["SIDING"], isPublic: false, isTaxExempt: false, address: "1 TEST_ONLY Way" }, actor);
    await prisma.project.update({ where: { id: job.id }, data: { status: "SOLD", contractAmount: 25000 } });
    const read = ticket({
      poNumber: job.name.replace("TEST_ONLY ", ""),
      lines: [
        { itemNumber: item.itemNumber, description: item.description, quantity: 3, uom: item.uom, unitPrice: null, extendedPrice: null, orderedQuantity: 3, handwritten: false },
        { itemNumber: null, description: "#1179 Trim Nail", quantity: 1, uom: null, unitPrice: null, extendedPrice: null, orderedQuantity: null, handwritten: true },
      ],
    });
    setAiClientForTests({ beta: { messages: { parse: async () => ({ stop_reason: "end_turn", model: "fake", parsed_output: read }) } } } as never);
    const id = await scanReceipt([{ bytes: await fakePhoto(), name: "t.jpg" }], actor);
    let d = (await loadReceipt(id))!;
    expect(d.match?.projectId).toBe(job.id); // the PO is the job name; the shop address is ignored
    expect(d.lines[0]).toMatchObject({ priced: "SHEET", amount: Math.round(3 * item.unitPrice! * 100) / 100 });
    expect(d.lines[1].amount).toBeNull();
    await expect(approveReceipt(id, { projectId: job.id, outcome: "CHANGE_ORDER", markupPct: 15, lineMarkup: {}, reason: null }, actor)).rejects.toThrow(/Line 2 has no price/);
    await setLinePrices(id, { "1": 8.5 }, actor);
    d = (await loadReceipt(id))!;
    expect(d.lines[1]).toMatchObject({ priced: "ENTERED", amount: 8.5 });
    const r = await approveReceipt(id, { projectId: job.id, outcome: "CHANGE_ORDER", markupPct: 15, lineMarkup: {}, reason: "TEST_ONLY extra trim" }, actor);
    expect(r.count).toBe(0);
    expect(await prisma.jobCost.count({ where: { projectId: job.id } })).toBe(0); // ABC's invoice brings the cost
    const expected = receiptPricing([Math.round(3 * item.unitPrice! * 100) / 100, 8.5], null, [15, 15]).billed; // marked up line by line
    expect((await prisma.changeOrder.findUniqueOrThrow({ where: { id: r.changeOrderId! } })).amount).toBe(expected);
    expect(await prisma.document.count({ where: { projectId: job.id, fileName: { startsWith: "Delivery ticket" } } })).toBe(1);
  });

  it("crop/rotate reads the page again", async () => {
    const a = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    let reads = 0;
    setAiClientForTests({ beta: { messages: { parse: async () => (reads++, { stop_reason: "end_turn", model: "fake", parsed_output: ticket() }) } } } as never);
    const id = await scanReceipt([{ bytes: await fakePhoto(), name: "t.jpg" }], { id: a.id, name: a.name });
    await recropAndReread(id, 0, { crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, rotate: 90 }, { role: "ADMIN" });
    const f = ((await prisma.receiptScan.findUniqueOrThrow({ where: { id } })).files as { crop: unknown; rotate: number }[])[0];
    expect(f).toMatchObject({ crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, rotate: 90 });
    expect(reads).toBe(2);
    await expect(recropAndReread(id, 0, { crop: { x: 0.9, y: 0.9, w: 0.01, h: 0.01 }, rotate: 0 }, { role: "ADMIN" })).rejects.toThrow(/bigger box/);
  });
});
