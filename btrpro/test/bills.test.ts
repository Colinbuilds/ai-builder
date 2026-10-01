// TEST_ONLY supplier bills: three-way match and approval. AI reading is faked; no real invoices.
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { setAiClientForTests } from "@/lib/ai/claude";
import { createProject } from "@/lib/projects/service";
import { matchBill } from "@/lib/bills/match";
import { approveBill, disputeBill, markBillPaid, scanBill } from "@/lib/bills/service";
import { saveSettings } from "@/lib/settings";

afterAll(async () => {
  setAiClientForTests(null);
  await prisma.$disconnect();
});

const line = (o: Partial<Parameters<typeof matchBill>[0]["lines"][number]> = {}) => ({ itemNumber: "TEST1", description: "TEST_ONLY drip edge", quantity: 20, uom: "PC", amount: 140, priceStatus: "OK", priceNote: "Matches sheet.", overBy: null, ...o });
const order = (received: number, quantity = 20) => ({ number: "PO-TEST", tickets: 1, lines: [{ id: "ol1", itemNumber: "TEST1", description: "TEST_ONLY drip edge", quantity, unit: "PC", received, returned: 0 }] });

describe("three-way match", () => {
  it("is ready when billed = ordered = delivered at sheet price", () => {
    const m = matchBill({ lines: [line()], order: order(20), hasJob: true, duplicateOf: null, mathFlags: [], billedBefore: {} });
    expect(m.ready).toBe(true);
  });
  it("flags billed-not-delivered, over-ordered, off-PO and over-sheet lines", () => {
    const m = matchBill({
      lines: [line({ quantity: 22 }), line({ itemNumber: "ZZZ", description: "TEST_ONLY mystery item" }), line({ itemNumber: "TEST1", priceStatus: "OVER", priceNote: "Billed $7.50 vs $7.00." })],
      order: order(18),
      hasJob: true,
      duplicateOf: null,
      mathFlags: [],
      billedBefore: {},
    });
    expect(m.ready).toBe(false);
    expect(m.lines[0].flags).toEqual(expect.arrayContaining(["MORE_THAN_ORDERED", "MORE_THAN_DELIVERED"]));
    expect(m.lines[1].flags).toContain("NOT_ON_PO");
    // the third line has no order line left to match (the first used it), so it's off-PO and over sheet
    expect(m.lines[2].flags).toEqual(expect.arrayContaining(["OVER_SHEET"]));
  });
  it("counts earlier bills so the same delivery isn't paid twice", () => {
    const m = matchBill({ lines: [line({ quantity: 10 })], order: order(20), hasJob: true, duplicateOf: null, mathFlags: [], billedBefore: { ol1: 20 } });
    expect(m.lines[0].flags).toEqual(expect.arrayContaining(["MORE_THAN_DELIVERED", "ALREADY_BILLED"]));
  });
  it("needs a job and flags duplicates; a missing delivery ticket is only a warning", () => {
    expect(matchBill({ lines: [line()], order: null, hasJob: false, duplicateOf: "x", mathFlags: [], billedBefore: {} }).flags).toEqual(["NO_JOB", "DUPLICATE", "NO_PO"]);
    const noTicket = matchBill({ lines: [line()], order: { ...order(0), tickets: 0 }, hasJob: true, duplicateOf: null, mathFlags: [], billedBefore: {} });
    expect(noTicket.flags).toEqual(["NO_DELIVERY"]);
    expect(noTicket.ready).toBe(true);
  });
});

describe("bill flow", () => {
  it("reads, matches the PO, needs a note over flags, approves into costs, then paid", async () => {
    const a = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const office = { id: a.id, name: "TEST_ONLY Office", role: "OFFICE" as const, isOwner: false };
    const owner = { id: a.id, name: a.name, role: "ADMIN" as const, isOwner: true };
    const job = await createProject({ name: "TEST_ONLY Bill job", scopes: ["STEEP"], isPublic: false, isTaxExempt: false, address: "77 TEST_ONLY Rd" }, a);
    const num = `PO-T${Date.now().toString(36).toUpperCase()}`;
    const o = await prisma.materialOrder.create({
      data: { projectId: job.id, number: num, supplier: "ABC Supply", status: "DELIVERED" as never, createdBy: "test", lines: { create: [{ itemNumber: "TB-1", description: "TEST_ONLY drip edge", quantity: 20, unit: "PC", received: 18 }] } },
    });
    await prisma.deliveryTicket.create({ data: { orderId: o.id, date: new Date(), receivedBy: "test" } });
    const inv = `T-${Date.now().toString(36)}`;
    const read = {
      documentType: "INVOICE",
      vendor: "ABC Supply Co",
      branch: null,
      invoiceNumber: inv,
      orderNumber: null,
      poNumber: num,
      jobName: null,
      shipToName: null,
      shipToAddress: null,
      date: "2026-09-20",
      dueDate: "2026-10-10",
      terms: "NET 10TH PROX",
      lines: [{ itemNumber: "TB-1", description: "TEST_ONLY drip edge", orderedQuantity: null, handwritten: false, quantity: 20, uom: "PC", unitPrice: 7, extendedPrice: 140 }],
      subtotal: 140,
      tax: 9.8,
      total: 149.8,
      notes: [],
    };
    setAiClientForTests({ beta: { messages: { parse: async () => ({ stop_reason: "end_turn", model: "fake", parsed_output: read }) } } } as never);
    const img = new Uint8Array(await sharp({ create: { width: 30, height: 40, channels: 3, background: "#fff" } }).jpeg().toBuffer());
    const id = await scanBill([{ bytes: img, name: "inv.jpg" }], a);
    const bill = await prisma.supplierBill.findUniqueOrThrow({ where: { id } });
    expect(bill).toMatchObject({ projectId: job.id, orderId: o.id, status: "NEEDS_LOOK", invoiceNumber: inv, total: 149.8, terms: "NET 10TH PROX" });
    expect(bill.dueDate?.toISOString().slice(0, 10)).toBe("2026-10-10");

    await expect(approveBill(id, null, office)).rejects.toThrow(/has flags/);
    // with an owner limit, the office can't push flagged bills through
    await saveSettings({ billOwnerOver: 100 }, a);
    await expect(approveBill(id, "TEST_ONLY 2 extra approved", office)).rejects.toThrow(/owner/);
    const ok = await approveBill(id, "TEST_ONLY 2 extra approved", owner);
    await saveSettings({ billOwnerOver: null }, a);
    expect(ok).toMatchObject({ status: "APPROVED", ownerApprovedBy: a.name });
    expect(ok.qboStatus).toMatch(/isn't connected/);
    expect(await prisma.jobCost.count({ where: { projectId: job.id } })).toBeGreaterThan(0);

    // the same invoice scanned again is caught as a duplicate
    const id2 = await scanBill([{ bytes: img, name: "inv-again.jpg" }], a);
    const b2 = await prisma.supplierBill.findUniqueOrThrow({ where: { id: id2 } });
    expect((b2.match as { flags: string[] }).flags).toContain("DUPLICATE");
    const d = await disputeBill(id2, "TEST_ONLY duplicate of an approved invoice", null, office);
    expect(d.sent).toBe(false);
    expect(d.text).toMatch(new RegExp(inv));
    expect((await prisma.supplierBill.findUniqueOrThrow({ where: { id: id2 } })).status).toBe("DISPUTED");

    await markBillPaid(id, "TEST_ONLY chk 1001", office);
    expect((await prisma.supplierBill.findUniqueOrThrow({ where: { id } })).status).toBe("PAID");
  });
});
