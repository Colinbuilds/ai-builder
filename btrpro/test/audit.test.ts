// TEST_ONLY owner audit: risky items first; a flag becomes a task for whoever approved it.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { auditQueue, reviewItem } from "@/lib/audit";

afterAll(() => prisma.$disconnect());

describe("owner audit", () => {
  it("puts a bill approved over flags first, then clears it once reviewed", async () => {
    const a = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const scan = () => prisma.receiptScan.create({ data: { files: [], createdById: a.id } });
    const tag = Date.now().toString(36);
    const plain = await prisma.supplierBill.create({ data: { scanId: (await scan()).id, vendor: `TEST_ONLY Vendor ${tag}`, invoiceNumber: "A1", total: 100, status: "APPROVED", approvedAt: new Date(), approvedBy: a.name } });
    const risky = await prisma.supplierBill.create({ data: { scanId: (await scan()).id, vendor: `TEST_ONLY Vendor ${tag}`, invoiceNumber: "A2", total: 100, status: "APPROVED", approvedAt: new Date(), approvedBy: a.name, approveNote: "TEST_ONLY extra approved" } });
    let q = (await auditQueue()).filter((i) => i.id === plain.id || i.id === risky.id);
    expect(q.map((i) => i.id)).toEqual([risky.id, plain.id]);
    expect(q[0].reasons.join(" ")).toMatch(/Approved over flags/);
    await expect(reviewItem("SUPPLIER_BILL", risky.id, "FLAG", null, a, { title: "x", projectId: null, approvedBy: a.name })).rejects.toThrow(/second look/);
    await reviewItem("SUPPLIER_BILL", risky.id, "FLAG", "TEST_ONLY why the extra?", a, { title: "TEST A2", projectId: null, approvedBy: a.name });
    const task = await prisma.task.findFirst({ where: { auto: `AUDIT:SUPPLIER_BILL:${risky.id}` } });
    expect(task?.assigneeId).toBe(a.id);
    q = (await auditQueue()).filter((i) => i.id === plain.id || i.id === risky.id);
    expect(q.map((i) => i.id)).toEqual([plain.id]);
  });
});
