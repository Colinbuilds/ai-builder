// Regression tests for bugs found in code review of the operations build.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import {
  createInvoice,
  handleStripeEvent,
  loadBilling,
  recordPayment,
  sendInvoice,
  voidInvoice,
} from "@/lib/billing/service";
import { deleteProject } from "@/lib/projects/delete";
import { nextInSequence } from "@/lib/numbering";
import { matchAccount } from "@/lib/import/schedule";

afterAll(() => prisma.$disconnect());
const admin = async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  return { id: u.id, name: u.name, role: "ADMIN" as const };
};
async function soldJob(
  name: string,
  market: "RESIDENTIAL" | "COMMERCIAL" = "RESIDENTIAL",
  contract = 10000,
) {
  const a = await admin();
  const p = await createProject(
    { name, market, scopes: ["STEEP"], isPublic: false, isTaxExempt: false },
    a,
  );
  await prisma.project.update({
    where: { id: p.id },
    data: {
      status: "SOLD",
      contractAmount: contract,
      contractSignedAt: new Date(),
      retainagePct: market === "COMMERCIAL" ? 10 : null,
    },
  });
  return { a, p };
}
const stripeEvent = (session: string, invoiceId: string, amount: number) => ({
  id: `evt_${session}`,
  type: "checkout.session.completed",
  data: {
    object: {
      id: session,
      payment_status: "paid",
      metadata: { invoiceId, amount: amount.toFixed(2), surcharge: "0" },
    },
  },
});

describe("document numbers", () => {
  it("use the highest number + 1, so deleting a job never makes a number repeat", async () => {
    expect(
      nextInSequence("INV-2026-", [
        "INV-2026-0001",
        "INV-2026-0007",
        "INV-2026-0003",
        "MO-2026-0099",
      ]),
    ).toBe("INV-2026-0008");
    expect(nextInSequence("WO-2026-", [])).toBe("WO-2026-0001");
    const { a, p: gone } = await soldJob("TEST_ONLY Numbering A");
    const { p: kept } = await soldJob("TEST_ONLY Numbering B");
    await createInvoice(
      gone.id,
      { kind: "PROGRESS", lines: [{ description: "TEST_ONLY", amount: 100 }] },
      a,
    );
    const last = await createInvoice(
      kept.id,
      { kind: "PROGRESS", lines: [{ description: "TEST_ONLY", amount: 100 }] },
      a,
    );
    await deleteProject(gone.id, "TEST_ONLY Numbering A", a);
    const next = await createInvoice(
      kept.id,
      { kind: "PROGRESS", lines: [{ description: "TEST_ONLY", amount: 100 }] },
      a,
    );
    expect(Number(next.number.slice(-4))).toBe(
      Number(last.number.slice(-4)) + 1,
    );
  });
});

describe("Stripe payments are never dropped", () => {
  it("applies what's still due and flags the rest; a voided invoice gets a refund task; retries are ignored", async () => {
    const { a, p } = await soldJob("TEST_ONLY Stripe race");
    const inv = await createInvoice(
      p.id,
      { kind: "PROGRESS", lines: [{ description: "TEST_ONLY", amount: 1000 }] },
      a,
    );
    await sendInvoice(inv.id, { name: null, email: null }, a);
    // checkout opened for $1,000, then the office recorded a $400 check
    await recordPayment(
      inv.id,
      { date: new Date(), amount: 400, method: "CHECK", reference: "TEST-1" },
      a,
    );
    await handleStripeEvent(stripeEvent("cs_TEST_ONLY_race", inv.id, 1000));
    const after = await prisma.invoice.findUniqueOrThrow({
      where: { id: inv.id },
      include: { payments: true },
    });
    expect(after.status).toBe("PAID");
    expect(after.payments.find((x) => x.source === "STRIPE")?.amount).toBe(600);
    const task = await prisma.task.findFirstOrThrow({
      where: { auto: "STRIPE:cs_TEST_ONLY_race" },
    });
    expect(task.title).toMatch(/\$400\.00 .*Refund it in Stripe/);
    await handleStripeEvent(stripeEvent("cs_TEST_ONLY_race", inv.id, 1000)); // Stripe retries
    expect(
      await prisma.payment.count({
        where: { externalId: "cs_TEST_ONLY_race" },
      }),
    ).toBe(1);
    expect(
      await prisma.task.count({ where: { auto: "STRIPE:cs_TEST_ONLY_race" } }),
    ).toBe(1);

    const v = await createInvoice(
      p.id,
      { kind: "PROGRESS", lines: [{ description: "TEST_ONLY", amount: 500 }] },
      a,
    );
    await sendInvoice(v.id, { name: null, email: null }, a);
    await voidInvoice(v.id, "TEST_ONLY wrong amount", a);
    await handleStripeEvent(stripeEvent("cs_TEST_ONLY_void", v.id, 500));
    expect(await prisma.payment.count({ where: { invoiceId: v.id } })).toBe(0);
    expect(
      (
        await prisma.task.findFirstOrThrow({
          where: { auto: "STRIPE:cs_TEST_ONLY_void" },
        })
      ).title,
    ).toMatch(/void/);
  });
});

describe("retainage release", () => {
  it("can't be released twice through two drafts", async () => {
    const { a, p } = await soldJob("TEST_ONLY Retainage", "COMMERCIAL", 100000);
    const i1 = await createInvoice(
      p.id,
      {
        kind: "PROGRESS",
        lines: [{ description: "TEST_ONLY pay app", amount: 100000 }],
      },
      a,
    );
    await sendInvoice(i1.id, { name: null, email: null }, a);
    expect((await loadBilling(p.id)).summary.retainageHeld).toBe(10000);
    await createInvoice(
      p.id,
      {
        kind: "RETAINAGE_RELEASE",
        lines: [{ description: "TEST_ONLY release", amount: 10000 }],
      },
      a,
    );
    await expect(
      createInvoice(
        p.id,
        {
          kind: "RETAINAGE_RELEASE",
          lines: [{ description: "TEST_ONLY again", amount: 10000 }],
        },
        a,
      ),
    ).rejects.toThrow(/\$0\.00 of retainage is left/);
  });
});

describe("schedule account matching", () => {
  it("honors a market written in parentheses", () => {
    const A = [
      { id: "omaha", name: "DR Horton (Omaha)", type: "BUILDER" },
      { id: "kc", name: "DR Horton (Kansas City)", type: "BUILDER" },
    ];
    expect(matchAccount("DR Horton (Kansas City)", A).account?.id).toBe("kc");
    expect(
      matchAccount("DR Horton (Kansas City) - Lot 12", A).account?.id,
    ).toBe("kc");
    expect(matchAccount("DR Horton Westbrook", A).account?.id).toBe("omaha");
  });
});
