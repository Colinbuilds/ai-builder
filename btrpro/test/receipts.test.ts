// TEST_ONLY receipts, jobs and a TEST_ONLY builder price sheet. The AI is faked.
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { setAiClientForTests } from "@/lib/ai/claude";
import { createProject } from "@/lib/projects/service";
import { lineAmount, matchReceiptJob, priceCheckLine, totalsCheck, type Receipt, type SheetPrice } from "@/lib/receipts/check";
import { fileReceipt, loadReceipt, scanReceipt } from "@/lib/receipts/service";

afterAll(() => {
  setAiClientForTests(null);
  return prisma.$disconnect();
});

const receipt = (over: Partial<Receipt> = {}): Receipt => ({
  vendor: "ABC Supply Co",
  branch: "TEST_ONLY 112",
  invoiceNumber: null,
  orderNumber: null,
  poNumber: null,
  jobName: null,
  shipToName: null,
  shipToAddress: null,
  date: "2026-09-29",
  lines: [],
  subtotal: null,
  tax: null,
  total: null,
  notes: [],
  ...over,
});

describe("receipt math (code, not AI)", () => {
  it("uses the printed amount, computes qty × price only when it's missing, and flags mismatches", () => {
    expect(lineAmount({ itemNumber: "1", description: "x", quantity: 3, uom: "BX", unitPrice: 10, extendedPrice: 30 })).toEqual({ amount: 30, formula: null, mathFlag: null });
    expect(lineAmount({ itemNumber: "1", description: "x", quantity: 3, uom: "BX", unitPrice: 10, extendedPrice: null })).toEqual({ amount: 30, formula: "3 × $10.00", mathFlag: null });
    expect(lineAmount({ itemNumber: "1", description: "x", quantity: 3, uom: "BX", unitPrice: 10, extendedPrice: 33 }).mathFlag).toMatch(/3 × \$10.00 = \$30.00/);
    const r = receipt({ lines: [{ itemNumber: "1", description: "x", quantity: 2, uom: "EA", unitPrice: 5, extendedPrice: 10 }], subtotal: 12, tax: 1, total: 14 });
    expect(totalsCheck(r).flags.join(" ")).toMatch(/subtotal is \$12.00.*printed total is \$14.00/);
  });
});

describe("job matching", () => {
  const jobs = [
    { id: "j1", name: "TEST_ONLY Smith Reroof", address: "1234 Maple St, Omaha NE", status: "SOLD", acculynxJobNumber: null, clientName: null },
    { id: "j2", name: "TEST_ONLY Lot 7 Prairie Ridge", address: "555 Oak Ave, Elkhorn NE", status: "SCHEDULED", acculynxJobNumber: "4410", clientName: "TEST_ONLY Homes" },
    { id: "j3", name: "TEST_ONLY Jones Siding", address: "900 Pine Rd, Omaha NE", status: "SOLD", acculynxJobNumber: null, clientName: null },
  ];
  const orders = [{ projectId: "j3", number: "PO-2026-0042", supplierOrderNumber: "88123" }];
  it("PO beats everything, then address, then job name; ambiguity picks nothing", () => {
    expect(matchReceiptJob(receipt({ poNumber: "PO-2026-0042", shipToAddress: "1234 Maple St" }), jobs, orders).match?.projectId).toBe("j3");
    expect(matchReceiptJob(receipt({ orderNumber: "88123" }), jobs, orders).match?.projectId).toBe("j3");
    expect(matchReceiptJob(receipt({ shipToAddress: "1234 MAPLE STREET OMAHA" }), jobs, orders).match).toMatchObject({ projectId: "j1" });
    expect(matchReceiptJob(receipt({ poNumber: "PRAIRIE RIDGE LOT 7" }), jobs, orders).match?.projectId).toBe("j2");
    expect(matchReceiptJob(receipt({ poNumber: "4410" }), jobs, orders).match?.projectId).toBe("j2");
    const twins = [...jobs, { ...jobs[0], id: "j4", name: "TEST_ONLY Smith Gutters" }];
    const amb = matchReceiptJob(receipt({ shipToAddress: "1234 Maple St" }), twins, orders);
    expect(amb.match).toBeNull();
    expect(amb.candidates.map((c) => c.projectId).sort()).toEqual(["j1", "j4"]);
    expect(matchReceiptJob(receipt({ poNumber: "CASH SALE" }), jobs, orders).match).toBeNull();
  });
});

describe("price check", () => {
  const std: SheetPrice = { code: "SS", name: "Steep", unitPrice: 20, uom: "BX", builder: false, description: "TEST_ONLY nails" };
  const bld: SheetPrice = { ...std, code: "TB-SS", unitPrice: 18, builder: true };
  const line = (unitPrice: number | null, uom = "BX") => ({ itemNumber: "TEST1", description: "TEST_ONLY nails", quantity: 4, uom, unitPrice, extendedPrice: null });
  const standard = { builderName: null, fallback: null };
  const builder = (fallback: "STANDARD" | "MISSING" | null) => ({ builderName: "TEST_ONLY Homes", fallback });
  it("compares against BTR standard on standard jobs", () => {
    expect(priceCheckLine(line(20), [std], standard).status).toBe("OK");
    const over = priceCheckLine(line(21.5), [std], standard);
    expect(over).toMatchObject({ status: "OVER", diffEach: 1.5, diffTotal: 6 });
    expect(priceCheckLine(line(20, "EA"), [std], standard).status).toBe("UOM");
    expect(priceCheckLine({ ...line(20), itemNumber: null }, [], standard).status).toBe("NO_ITEM_NUMBER");
    expect(priceCheckLine(line(20), [], standard).status).toBe("NOT_ON_SHEETS");
    expect(priceCheckLine(line(20), [{ ...std, unitPrice: null }], standard).status).toBe("CALL");
  });
  it("builder jobs use the builder's own price, and the builder's fallback decides the rest", () => {
    const r = priceCheckLine(line(20), [std, bld], builder("MISSING"));
    expect(r).toMatchObject({ status: "OVER", diffEach: 2 });
    expect(r.compared?.builder).toBe(true);
    expect(priceCheckLine(line(20), [std], builder("MISSING")).status).toBe("NOT_ON_BUILDER");
    expect(priceCheckLine(line(20), [std], builder("STANDARD")).status).toBe("OK");
  });
});

describe("scan → match → price check → file", () => {
  it("reads a photo, finds the job by address, checks the builder price, and files the lines", async () => {
    const a = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const actor = { id: a.id, name: a.name, role: "ADMIN" as const };
    const item = await prisma.priceItem.findFirstOrThrow({ where: { unitPrice: { not: null }, sheet: { isActive: true, companyId: null } } });
    const builder = await prisma.company.create({ data: { name: "TEST_ONLY Receipt Homes", type: "BUILDER", pricingFallback: "STANDARD" } });
    const sheet = await prisma.priceSheet.create({ data: { code: "TRH-SS", name: "TEST_ONLY builder sheet", companyId: builder.id } });
    await prisma.priceItem.create({ data: { sheetId: sheet.id, section: "TEST", itemNumber: item.itemNumber, description: item.description, unitPrice: item.unitPrice! - 1, uom: item.uom } });
    const job = await createProject({ name: "TEST_ONLY Receipt job", scopes: ["STEEP"], isPublic: false, isTaxExempt: false, address: "4321 Birch Ct (TEST_ONLY), Omaha NE", clientCompanyId: builder.id }, actor);
    const billed = item.unitPrice!;
    setAiClientForTests({
      beta: {
        messages: {
          parse: async () => ({
            stop_reason: "end_turn",
            model: "fake",
            parsed_output: receipt({
              invoiceNumber: `TEST-INV-${job.id.slice(-6)}`,
              shipToAddress: "4321 Birch Ct Omaha",
              lines: [
                { itemNumber: item.itemNumber, description: item.description, quantity: 2, uom: item.uom, unitPrice: billed, extendedPrice: Math.round(billed * 200) / 100 },
                { itemNumber: null, description: "TEST_ONLY delivery", quantity: 1, uom: "EA", unitPrice: 75, extendedPrice: 75 },
              ],
              tax: 3.5,
            }),
          }),
        },
      },
    } as never);
    const img = new Uint8Array(await sharp({ create: { width: 40, height: 60, channels: 3, background: "#fff" } }).jpeg().toBuffer());
    const id = await scanReceipt([{ bytes: img, name: "r.jpg" }], actor);
    const d = (await loadReceipt(id))!;
    expect(d.match?.projectId).toBe(job.id);
    expect(d.match?.by).toMatch(/address/);
    expect(d.lines[0].check).toMatchObject({ status: "OVER", diffEach: 1, diffTotal: 2 });
    expect(d.lines[0].check.compared?.builder).toBe(true);
    expect(d.lines[1].check.status).toBe("NO_ITEM_NUMBER");
    const res = await fileReceipt(id, job.id, actor);
    expect(res.count).toBe(3); // two lines + the tax line
    const costs = await prisma.jobCost.findMany({ where: { projectId: job.id }, orderBy: { amount: "asc" } });
    expect(costs.map((c) => c.amount).sort((x, y) => x - y)).toEqual([3.5, Math.round(billed * 200) / 100, 75].sort((x, y) => x - y));
    expect(costs.find((c) => c.itemNumber === item.itemNumber)?.sheetPrice).toBe(item.unitPrice! - 1);
    await expect(fileReceipt(id, job.id, actor)).rejects.toThrow(/already filed/);
    expect(await prisma.document.count({ where: { projectId: job.id } })).toBe(1);
  });
});
