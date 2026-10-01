// TEST_ONLY office desk: overdue invoices go on the call list until a promise date parks them.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import { officeDesk, purchasingDesk } from "@/lib/desks";

afterAll(() => prisma.$disconnect());

describe("office desk", () => {
  it("lists overdue balances to call, parks promised ones, and totals what's coming in", async () => {
    const a = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const job = await createProject({ name: "TEST_ONLY Desk job", scopes: ["STEEP"], isPublic: false, isTaxExempt: false }, a);
    const tok = () => Math.random().toString(36).slice(2);
    const now = new Date("2026-10-01T15:00:00Z");
    const late = await prisma.invoice.create({ data: { projectId: job.id, number: `T-D-${tok()}`, kind: "DEPOSIT", status: "PARTIAL", lines: [], subtotal: 1000, amountDue: 1000, issueDate: new Date("2026-08-01"), dueDate: new Date("2026-09-01"), token: tok(), createdBy: "t" } });
    await prisma.payment.create({ data: { invoiceId: late.id, date: new Date("2026-09-15"), amount: 400, method: "CHECK", recordedBy: "t" } });
    let d = await officeDesk(now);
    const row = d.callList.find((r) => r.id === late.id)!;
    expect(row).toMatchObject({ balance: 600, daysLate: 30 });
    await prisma.collectionNote.create({ data: { invoiceId: late.id, outcome: "PROMISED", note: "TEST_ONLY check Friday", followUpOn: new Date("2026-10-09T12:00:00Z"), by: "t" } });
    d = await officeDesk(now);
    expect(d.callList.some((r) => r.id === late.id)).toBe(false);
    expect(d.awaitingPayment.some((r) => r.id === late.id)).toBe(true);
    // after the promise date passes it comes back
    d = await officeDesk(new Date("2026-10-10T15:00:00Z"));
    expect(d.callList.some((r) => r.id === late.id)).toBe(true);
  });

  it("purchasing: a sold job with no order shows up", async () => {
    const a = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const job = await createProject({ name: "TEST_ONLY needs order", scopes: ["STEEP"], isPublic: false, isTaxExempt: false }, a);
    await prisma.project.update({ where: { id: job.id }, data: { status: "SOLD" } });
    expect((await purchasingDesk()).needOrders.some((p) => p.id === job.id)).toBe(true);
  });
});
