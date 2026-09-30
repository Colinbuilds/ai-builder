import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createProject, executeForm17 } from "@/lib/projects/service";
import { addLine, createEstimate } from "@/lib/estimates/service";
import { deliveryStatus, orderLinePrice, toOrderUnit } from "@/lib/orders/price";
import {
  addOrderLine,
  cancelOrder,
  confirmOrder,
  createOrder,
  loadOrder,
  receiveOrder,
  recordReturn,
  removeOrderLine,
  sendOrder,
  setLineQuantity,
  updateOrderDetails,
  type OrderActor,
} from "@/lib/orders/service";
import { importInvoices, loadCosting } from "@/lib/costing/service";

process.env.UPLOAD_DIR = "prisma/test-uploads";
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T17:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
  return prisma.$disconnect();
});

const admin = async (): Promise<OrderActor> => {
  const u = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  return { id: u.id, name: u.name, role: "ADMIN" };
};
const shingle = { uom: "SQ", unitPrice: 138, priceStatus: "LISTED", coverageQty: 3, coverageUnit: "BD/SQ" };

describe("order pricing", () => {
  it("prices bundles through the printed coverage, never guesses", () => {
    expect(orderLinePrice(99, "BD", shingle)).toEqual({ extended: 4554, formula: "33 SQ (99 BD) × $138.00/SQ = 4554.00" });
    expect(orderLinePrice(2, "RL", shingle).extended).toBeNull();
    expect(orderLinePrice(2, "SQ", { ...shingle, priceStatus: "CALL", unitPrice: null })).toEqual({ extended: null, formula: "CALL for price" });
    expect(orderLinePrice(2, "EA", null).extended).toBeNull();
  });
  it("orders shingles in whole bundles through the printed coverage", () => {
    expect(toOrderUnit(34.3333, "SQ", shingle)).toEqual({ quantity: 103, unit: "BD", note: "34.3333 SQ × 3 BD/SQ = 103 BD" });
    expect(toOrderUnit(34.34, "SQ", shingle).quantity).toBe(104);
    expect(toOrderUnit(2.001, "RL", null)).toEqual({ quantity: 2.01, unit: "RL", note: null });
  });
  it("delivery status from received quantities", () => {
    expect(deliveryStatus([{ quantity: 10, received: 0, backordered: 0, returned: 0 }])).toBeNull();
    expect(deliveryStatus([{ quantity: 10, received: 4, backordered: 6, returned: 0 }])).toBe("PARTIAL");
    expect(deliveryStatus([{ quantity: 10, received: 10, backordered: 0, returned: 0 }, { quantity: null, received: 0, backordered: 0, returned: 0 }])).toBe("DELIVERED");
  });
});

async function job(opts: { isPublic?: boolean; isTaxExempt?: boolean } = {}) {
  const a = await admin();
  const p = await createProject({ name: `TEST_ONLY Order job ${Math.random().toString(36).slice(2, 6)}`, market: "COMMERCIAL", scopes: ["STEEP"], address: "5 Supply Rd", isPublic: !!opts.isPublic, isTaxExempt: !!opts.isTaxExempt }, a);
  const e = await createEstimate(p.id, "STEEP", a);
  await addLine(e.id, { section: "MATERIAL_ROOFING", itemNumber: "02MLVIA3AB", quantity: 99, unit: "BD", source: "TEST_ONLY" } as never, a);
  await addLine(e.id, { section: "MATERIAL_ROOFING", itemName: "Mystery flashing", quantity: null, unit: "EA", source: "TEST_ONLY" } as never, a);
  await addLine(e.id, { section: "GENERAL_CONDITIONS", itemName: "Dumpster", quantity: 1, unit: "EA", unitCost: 450, source: "TEST_ONLY" }, a);
  return { a, p, e };
}

const details = { requestedDate: new Date("2026-10-06T12:00:00Z"), deliveryWindow: "AM", dropLocation: "Roof load (boom)", siteContact: "TEST_ONLY Foreman 402-555-0100", notes: null };

describe("material orders", () => {
  it("builds from the estimate's material lines only, and won't send with a MISSING quantity or no delivery details", async () => {
    const { a, p, e } = await job();
    const o = await createOrder(p.id, e.id, a);
    const full = await loadOrder(o.id);
    expect(full.lines.map((l) => l.description).sort()).toEqual(expect.arrayContaining(["Mystery flashing"]));
    expect(full.lines.some((l) => l.description === "Dumpster")).toBe(false);
    await expect(sendOrder(o.id, { method: "MANUAL" }, a)).rejects.toThrow(/Quantity MISSING on: Mystery flashing.*delivery date/);
    await setLineQuantity(full.lines.find((l) => l.description === "Mystery flashing")!.id, 4, a);
    await updateOrderDetails(o.id, details, a);
    const r = await sendOrder(o.id, { method: "MANUAL" }, a);
    expect(r.unpriced).toBe(1);
    const sent = await loadOrder(o.id);
    expect(sent.status).toBe("SENT");
    expect(sent.commitment).toMatchObject({ category: "MATERIALS", reference: sent.number, status: "OPEN" });
    await expect(addOrderLine(o.id, { itemNumber: "04MLWSSAB", description: null, quantity: 2, unit: null }, a)).rejects.toThrow(/already sent/);
  });

  it("PUB-01: no material order on a public tax-exempt job until the Form 17 is executed", async () => {
    const { a, p } = await job({ isPublic: true, isTaxExempt: true });
    const o = await createOrder(p.id, null, a);
    await addOrderLine(o.id, { itemNumber: "04MLWSSAB", description: null, quantity: 2, unit: null }, a);
    await updateOrderDetails(o.id, details, a);
    await expect(sendOrder(o.id, { method: "MANUAL" }, a)).rejects.toThrow(/PUB-01/);
    await executeForm17(p.id, { executedAt: new Date(), note: "TEST_ONLY" }, a);
    await sendOrder(o.id, { method: "MANUAL" }, a);
  });

  it("hand-added lines use the sheet unit; unknown item numbers are refused; free-text lines are unpriced", async () => {
    const { a, p } = await job();
    const o = await createOrder(p.id, null, a);
    const l = await addOrderLine(o.id, { itemNumber: "04MLWSSAB", description: null, quantity: 2, unit: "EA" }, a);
    expect(l).toMatchObject({ unit: "BD", extended: 253 });
    await expect(addOrderLine(o.id, { itemNumber: "NOPE123", description: null, quantity: 1, unit: null }, a)).rejects.toThrow(/isn't on a loaded price sheet/);
    const free = await addOrderLine(o.id, { itemNumber: null, description: "TEST_ONLY custom color coil", quantity: 1, unit: "rl" }, a);
    expect(free).toMatchObject({ unit: "RL", extended: null });
    await removeOrderLine(free.id, a);
    await expect(sendOrder(o.id, { method: "EMAIL" }, a)).rejects.toThrow(/delivery date/);
    await updateOrderDetails(o.id, details, a);
    await expect(sendOrder(o.id, { method: "EMAIL" }, a)).rejects.toThrow(/No order email|isn't set up/);
  });

  it("receiving: partial with a dated backorder, then complete; returns shrink the commitment", async () => {
    const { a, p } = await job();
    const o = await createOrder(p.id, null, a);
    const l = await addOrderLine(o.id, { itemNumber: "04MLWSSAB", description: null, quantity: 10, unit: null }, a);
    await updateOrderDetails(o.id, details, a);
    await expect(receiveOrder(o.id, { date: new Date(), ticketNumber: null, note: null, lines: [] }, a)).rejects.toThrow(/sent/);
    await sendOrder(o.id, { method: "MANUAL" }, a);
    await confirmOrder(o.id, { supplierOrderNumber: "TEST-ABC-555", confirmedDate: new Date("2026-10-07T12:00:00Z") }, a);
    await expect(receiveOrder(o.id, { date: new Date(), ticketNumber: "T1", note: null, lines: [{ id: l.id, received: 6, backordered: 4, backorderDate: null }] }, a)).rejects.toThrow(/backorder expected/);
    expect((await receiveOrder(o.id, { date: new Date(), ticketNumber: "T1", note: null, lines: [{ id: l.id, received: 6, backordered: 4, backorderDate: new Date("2026-10-12") }] }, a)).status).toBe("PARTIAL");
    expect((await receiveOrder(o.id, { date: new Date(), ticketNumber: "T2", note: null, lines: [{ id: l.id, received: 10, backordered: 0, backorderDate: null }] }, a)).status).toBe("DELIVERED");
    await expect(recordReturn(l.id, 11, "extra", a)).rejects.toThrow(/Only 10/);
    await expect(recordReturn(l.id, 2, "", a)).rejects.toThrow(/why/);
    expect(await recordReturn(l.id, 2, "TEST_ONLY extra bundles", a)).toEqual({ credit: 253 });
    const after = await loadOrder(o.id);
    expect(after.commitment!.amount).toBe(1265 - 253);
    expect(after.tickets).toHaveLength(2);
    await expect(cancelOrder(o.id, "x", a)).rejects.toThrow(/returns/);
  });

  it("an imported invoice carrying the PO bills the order's commitment", async () => {
    const { a, p } = await job();
    const o = await createOrder(p.id, null, a);
    await addOrderLine(o.id, { itemNumber: "04MLWSSAB", description: null, quantity: 4, unit: null }, a);
    await updateOrderDetails(o.id, details, a);
    await sendOrder(o.id, { method: "MANUAL" }, a);
    expect((await loadCosting(p.id)).pnl.committed).toBe(506);
    const csv = `Invoice #,Invoice Date,PO,Item #,Description,Qty,UOM,Unit Price,Extended\nTEST-INV-${o.number},09/30/2026,${o.number},04MLWSSAB,Windsor Starter,4,BD,126.50,506.00`;
    await importInvoices(p.id, csv, { pos: null, vendor: "ABC Supply" }, { ...a, role: "ADMIN" });
    const { pnl } = await loadCosting(p.id);
    expect(pnl.committed).toBe(0);
    expect(pnl.actual).toBe(506);
  });

  it("cancelling a sent order cancels its commitment and needs a reason", async () => {
    const { a, p } = await job();
    const o = await createOrder(p.id, null, a);
    await addOrderLine(o.id, { itemNumber: "04MLWSSAB", description: null, quantity: 1, unit: null }, a);
    await updateOrderDetails(o.id, details, a);
    await sendOrder(o.id, { method: "MANUAL" }, a);
    await expect(cancelOrder(o.id, "", a)).rejects.toThrow(/why/);
    await cancelOrder(o.id, "TEST_ONLY job pushed", a);
    expect((await loadOrder(o.id)).commitment!.status).toBe("CANCELLED");
  });

  it("viewers can't touch orders", async () => {
    const { p } = await job();
    await expect(createOrder(p.id, null, { id: "v", name: "V", role: "VIEWER" })).rejects.toThrow(/Viewers/);
  });
});
