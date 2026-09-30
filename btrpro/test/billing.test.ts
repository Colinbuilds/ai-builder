import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { createProject } from "@/lib/projects/service";
import { addLine, createEstimate } from "@/lib/estimates/service";
import { addLaborLine } from "@/lib/estimates/labor";
import { saveSettings } from "@/lib/settings";
import { freezeBaseline, addChangeOrder, decideChangeOrder } from "@/lib/costing/service";
import { agingBucket, billingSummary, cardSurcharge, invoiceTotals, paymentStatus } from "@/lib/billing/math";
import { arAging, createInvoice, deletePayment, getInvoiceByToken, handleStripeEvent, loadBilling, recordPayment, sendInvoice, suggest, verifyStripeSignature, voidInvoice, type BillActor } from "@/lib/billing/service";
import { createChangeOrderFromEstimate, declineChangeOrder, importChangeOrders, parseChangeOrderCsv, sendChangeOrder, signChangeOrder } from "@/lib/billing/change-orders";
import { syncInvoice, syncPayment } from "@/lib/integrations/quickbooks";

process.env.UPLOAD_DIR = "prisma/test-uploads";
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T17:00:00Z"));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  vi.useRealTimers();
  return prisma.$disconnect();
});
const d = (s: string) => new Date(`${s}T12:00:00Z`);
const admin = async (): Promise<BillActor & { id: string; role: "ADMIN" }> => {
  const u = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  return { id: u.id, name: u.name, role: "ADMIN" };
};

describe("billing math", () => {
  it("retainage only on progress/final/CO billing", () => {
    expect(invoiceTotals([{ description: "Roof 50%", amount: 50000 }], 10, "PROGRESS")).toEqual({ subtotal: 50000, retainagePct: 10, retainage: 5000, amountDue: 45000 });
    expect(invoiceTotals([{ description: "Deposit", amount: 3000 }], 10, "DEPOSIT")).toMatchObject({ retainage: 0, amountDue: 3000 });
    expect(() => invoiceTotals([{ description: "", amount: 5 }], null, "OTHER")).toThrow(/description/);
    expect(() => invoiceTotals([], null, "OTHER")).toThrow(/at least one/);
  });
  it("summary: billed vs contract, retainage held and released, AR", () => {
    const s = billingSummary(100000, [
      { kind: "PROGRESS", status: "PAID", subtotal: 50000, retainage: 5000, amountDue: 45000, payments: [{ amount: 45000 }] },
      { kind: "FINAL", status: "SENT", subtotal: 50000, retainage: 5000, amountDue: 45000, payments: [] },
      { kind: "RETAINAGE_RELEASE", status: "SENT", subtotal: 4000, retainage: 0, amountDue: 4000, payments: [] },
      { kind: "OTHER", status: "VOID", subtotal: 999, retainage: 0, amountDue: 999, payments: [] },
    ]);
    expect(s).toMatchObject({ billedWork: 100000, unbilled: 0, retainageHeld: 6000, paid: 45000, openAR: 49000, remaining: 55000 });
    expect(billingSummary(null, []).unbilled).toBeNull();
  });
  it("status, aging buckets, and card surcharge", () => {
    expect([paymentStatus(100, 0), paymentStatus(100, 40), paymentStatus(100, 100)]).toEqual(["SENT", "PARTIAL", "PAID"]);
    expect(agingBucket(d("2026-09-30"), d("2026-09-30"))).toBe("Current");
    expect(agingBucket(d("2026-09-01"), d("2026-09-30"))).toBe("1–30");
    expect(agingBucket(d("2026-06-01"), d("2026-09-30"))).toBe("90+");
    expect(cardSurcharge(1000, null)).toEqual({ surcharge: 0, formula: null });
    expect(cardSurcharge(1000, 3).surcharge).toBe(30);
  });
  it("verifies Stripe webhook signatures", () => {
    const secret = "whsec_TEST_ONLY";
    const body = '{"id":"evt_1"}';
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret)).toBe(true);
    expect(verifyStripeSignature(body + " ", `t=${t},v1=${sig}`, secret)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t - 1000},v1=${sig}`, secret)).toBe(false);
  });
});

async function soldJob(market: "RESIDENTIAL" | "COMMERCIAL" = "RESIDENTIAL", contract = 20000) {
  const a = await admin();
  const p = await createProject({ name: `TEST_ONLY Bill ${Math.random().toString(36).slice(2, 6)}`, market, scopes: ["STEEP"], address: "3 Pay St", isPublic: false, isTaxExempt: false }, a, market === "RESIDENTIAL" ? { firstName: "Pat", lastName: "Payer", email: "pat.payer@test.local" } : null);
  await prisma.project.update({ where: { id: p.id }, data: { status: "SOLD", contractAmount: contract, contractSignedAt: new Date(), retainagePct: market === "COMMERCIAL" ? 10 : null } });
  return { a, p };
}

describe("invoices and payments", () => {
  it("deposit suggestion, send, partial then full payment; check # required; overpay refused", async () => {
    const { a, p } = await soldJob();
    await saveSettings({ depositPct: 30, invoiceNetDays: 15 }, a);
    expect(await suggest(p.id, "DEPOSIT")).toEqual({ amount: 6000, why: "20000.00 contract × 30% deposit" });
    const inv = await createInvoice(p.id, { kind: "DEPOSIT", lines: [{ description: "Deposit per contract", amount: 6000 }] }, a);
    expect(inv).toMatchObject({ billTo: "Pat Payer", billToEmail: "pat.payer@test.local", amountDue: 6000 });
    expect(inv.dueDate.toISOString().slice(0, 10)).toBe("2026-10-15");
    expect(await getInvoiceByToken(inv.token)).toBeNull();
    await expect(recordPayment(inv.id, { date: new Date(), amount: 100, method: "CHECK", reference: "1" }, a)).rejects.toThrow(/Send the invoice/);
    await sendInvoice(inv.id, { name: null, email: null }, a);
    await expect(recordPayment(inv.id, { date: new Date(), amount: 1000, method: "CHECK", reference: null }, a)).rejects.toThrow(/check number/);
    await recordPayment(inv.id, { date: new Date(), amount: 2000, method: "CHECK", reference: "1042" }, a);
    await expect(recordPayment(inv.id, { date: new Date(), amount: 4000.01, method: "ACH", reference: null }, a)).rejects.toThrow(/more than the \$4000.00/);
    await recordPayment(inv.id, { date: new Date(), amount: 4000, method: "ACH", reference: null }, a);
    const { invoices, summary } = await loadBilling(p.id);
    expect(invoices[0].status).toBe("PAID");
    expect(summary).toMatchObject({ billedWork: 6000, unbilled: 14000, paid: 6000, openAR: 0 });
    await expect(voidInvoice(inv.id, "x", a)).rejects.toThrow(/Payments are recorded/);
    await saveSettings({ depositPct: null, invoiceNetDays: null }, a);
  });

  it("won't bill past the contract without a reason; approved change orders raise the cap", async () => {
    const { a, p } = await soldJob();
    await createInvoice(p.id, { kind: "PROGRESS", lines: [{ description: "Tear-off & install", amount: 15000 }] }, a);
    const over = createInvoice(p.id, { kind: "FINAL", lines: [{ description: "Balance", amount: 6000 }] }, a);
    await expect(over).rejects.toMatchObject({ needsOverride: true });
    await expect(createInvoice(p.id, { kind: "FINAL", lines: [{ description: "Balance", amount: 6000 }] }, a)).rejects.toThrow(/\$1000.00 past the contract/);
    const co = await addChangeOrder(p.id, { kind: "CHANGE_ORDER", description: "TEST_ONLY extra layer", amount: 1000, costImpact: 600, source: "TEST_ONLY" }, a);
    await decideChangeOrder(co.id, "APPROVED", a);
    const drafts = await prisma.invoice.findMany({ where: { projectId: p.id } });
    await sendInvoice(drafts[0].id, { name: null, email: null }, a);
    expect(await suggest(p.id, "FINAL")).toMatchObject({ amount: 6000 });
    await createInvoice(p.id, { kind: "FINAL", lines: [{ description: "Balance", amount: 6000 }] }, a);
  });

  it("commercial retainage: held on progress billing, released later, and the job goes to Paid when all is in", async () => {
    const { a, p } = await soldJob("COMMERCIAL", 100000);
    const i1 = await createInvoice(p.id, { kind: "PROGRESS", lines: [{ description: "Pay app 1", amount: 60000 }] }, a);
    expect(i1).toMatchObject({ retainage: 6000, amountDue: 54000 });
    await sendInvoice(i1.id, { name: null, email: null }, a);
    await recordPayment(i1.id, { date: new Date(), amount: 54000, method: "ACH", reference: null }, a);
    await prisma.project.update({ where: { id: p.id }, data: { status: "COMPLETE" } });
    const fin = await createInvoice(p.id, { kind: "FINAL", lines: [{ description: "Pay app 2 (final)", amount: 40000 }] }, a);
    await sendInvoice(fin.id, { name: null, email: null }, a);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("INVOICED");
    await recordPayment(fin.id, { date: new Date(), amount: 36000, method: "ACH", reference: null }, a);
    await expect(createInvoice(p.id, { kind: "RETAINAGE_RELEASE", lines: [{ description: "Release", amount: 10001 }] }, a)).rejects.toThrow(/Only \$10000.00/);
    const rel = await createInvoice(p.id, { kind: "RETAINAGE_RELEASE", lines: [{ description: "Retainage release", amount: 10000 }] }, a);
    expect(rel.retainage).toBe(0);
    await sendInvoice(rel.id, { name: null, email: null }, a);
    await recordPayment(rel.id, { date: new Date(), amount: 10000, method: "CHECK", reference: "88" }, a);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("PAID");
    const aging = await arAging(new Date());
    expect(aging.rows.some((r) => r.projectId === p.id)).toBe(false);
  });

  it("Stripe webhook records a card payment once, with the surcharge kept separate", async () => {
    const { a, p } = await soldJob();
    const inv = await createInvoice(p.id, { kind: "DEPOSIT", lines: [{ description: "Deposit", amount: 1000 }] }, a);
    await sendInvoice(inv.id, { name: null, email: null }, a);
    const ev = { id: "evt_TEST", type: "checkout.session.completed", data: { object: { id: "cs_TEST_ONLY_1", payment_status: "paid", metadata: { invoiceId: inv.id, amount: "1000.00", surcharge: "30.00" } } } };
    await handleStripeEvent(ev);
    await handleStripeEvent(ev);
    const pays = await prisma.payment.findMany({ where: { invoiceId: inv.id } });
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ amount: 1000, surcharge: 30, method: "CARD", source: "STRIPE" });
    await expect(deletePayment(pays[0].id, "x", { ...a, role: "ESTIMATOR" })).rejects.toThrow(/Admin/);
    await deletePayment(pays[0].id, "TEST_ONLY refund", a);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("SENT");
  });

  it("AR aging buckets open balances by days past due", async () => {
    const { a, p } = await soldJob();
    const inv = await createInvoice(p.id, { kind: "PROGRESS", lines: [{ description: "Old bill", amount: 500 }], issueDate: d("2026-06-01"), dueDate: d("2026-06-15") }, a);
    await sendInvoice(inv.id, { name: null, email: null }, a);
    const { rows } = await arAging(d("2026-09-30"));
    expect(rows.find((r) => r.id === inv.id)).toMatchObject({ bucket: "90+", balance: 500 });
  });
});

describe("change orders with customer signature", () => {
  it("prices from a separate complete estimate, the customer signs, and it's approved and filed", async () => {
    const { a, p } = await soldJob();
    await saveSettings({ markupPct: 25, salesTaxPct: null }, a);
    const base = await createEstimate(p.id, "STEEP", a);
    await addLine(base.id, { section: "GENERAL_CONDITIONS", itemName: "Dumpster", quantity: 1, unit: "EA", unitCost: 400, source: "TEST_ONLY" }, a);
    await addLaborLine(base.id, { task: "Install", quantity: 1, quantityUnit: "EA", quantitySource: "x", productionRate: 1, hourlyRate: 100, burdenPct: 0, rateSource: "TEST_ONLY" }, a);
    await freezeBaseline(p.id, base.id, a);
    await expect(createChangeOrderFromEstimate(p.id, { estimateId: base.id, markupPct: null, description: "x", kind: "CHANGE_ORDER" }, a)).rejects.toThrow(/sold estimate/);
    const coEst = await createEstimate(p.id, "STEEP", a);
    await addLine(coEst.id, { section: "GENERAL_CONDITIONS", itemName: "Decking", quantity: 10, unit: "SH", unitCost: 40, source: "TEST_ONLY" }, a);
    await addLaborLine(coEst.id, { task: "Replace decking", quantity: 10, quantityUnit: "SH", quantitySource: "x", productionRate: 5, hourlyRate: 50, burdenPct: 0, rateSource: "TEST_ONLY" }, a);
    const co = await createChangeOrderFromEstimate(p.id, { estimateId: coEst.id, markupPct: null, description: "TEST_ONLY rotted decking, 10 sheets", kind: "CHANGE_ORDER" }, a);
    expect(co).toMatchObject({ costImpact: 500, amount: 625 });
    const { url } = await sendChangeOrder(co.id, { name: "Pat", email: null }, a);
    const token = url.split("/co/")[1];
    await expect(signChangeOrder(token, { name: "Pat", email: "p@test.local", consent: false, signatureImage: null, ip: null })).rejects.toThrow(/electronically/);
    const signed = await signChangeOrder(token, { name: "Pat Payer", email: "p@test.local", consent: true, signatureImage: null, ip: "203.0.113.5" });
    expect(signed).toMatchObject({ status: "APPROVED", decidedBy: "Pat Payer (customer e-signature)" });
    expect(signed.signedDocumentId).toBeTruthy();
    await expect(declineChangeOrder(token, "no")).rejects.toThrow(/already approved/);
    expect((await loadBilling(p.id)).summary.revenue).toBe(20625);
    await saveSettings({ markupPct: null }, a);
  });

  it("imports Procore/Buildertrend CO exports once, approving only approved rows", async () => {
    const { a, p } = await soldJob("COMMERCIAL");
    const csv = "#,Title,Status,Grand Total\n001,TEST_ONLY Add cricket,Approved,\"$2,400.00\"\n002,TEST_ONLY Delete skylight,Pending,($300.00)\n003,TEST_ONLY Rejected thing,Rejected,500\n004,No amount,Approved,";
    expect(parseChangeOrderCsv(csv).problems[0]).toMatch(/No amount/);
    expect(await importChangeOrders(p.id, csv, "Procore", a)).toMatchObject({ created: 2, skipped: 0 });
    expect(await importChangeOrders(p.id, csv, "Procore", a)).toMatchObject({ created: 0, skipped: 2 });
    const cos = await prisma.changeOrder.findMany({ where: { projectId: p.id }, orderBy: { number: "asc" } });
    expect(cos.map((c) => [c.kind, c.status, c.amount])).toEqual([
      ["CHANGE_ORDER", "APPROVED", 2400],
      ["CREDIT", "PENDING", 300],
    ]);
  });
});

describe("QuickBooks push", () => {
  it("creates the customer, invoice (with retainage line) and payment, and keeps errors on the record", async () => {
    const { a, p } = await soldJob("COMMERCIAL", 50000);
    await prisma.integrationConnection.deleteMany({ where: { provider: "QUICKBOOKS" } });
    await prisma.integrationConnection.create({ data: { provider: "QUICKBOOKS", userId: null, accessToken: encrypt("TEST_ONLY"), expiresAt: new Date(Date.now() + 3600_000), extra: { realmId: "123" } } });
    const inv = await createInvoice(p.id, { kind: "PROGRESS", lines: [{ description: "Pay app 1", amount: 10000 }] }, a);
    await expect(syncInvoice(inv.id)).rejects.toThrow(/QuickBooks item/);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).qboError).toMatch(/QuickBooks item/);
    await saveSettings({ qboItemId: "7" }, a);
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
      const json = url.includes("/query") ? { QueryResponse: {} } : url.includes("/customer") ? { Customer: { Id: "C1" } } : url.includes("/invoice") ? { Invoice: { Id: "I1" } } : { Payment: { Id: "P1" } };
      return new Response(JSON.stringify(json), { status: 200 });
    });
    await sendInvoice(inv.id, { name: null, email: null }, a); // auto-syncs
    const synced = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(synced).toMatchObject({ qboId: "I1", qboError: null });
    const invCall = calls.find((c) => c.url.includes("/invoice"))!.body as { CustomerRef: { value: string }; Line: { Amount: number }[] };
    expect(invCall.CustomerRef.value).toBe("C1");
    expect(invCall.Line.map((l) => l.Amount)).toEqual([10000, -1000]);
    const pay = await recordPayment(inv.id, { date: new Date(), amount: 9000, method: "ACH", reference: null }, a);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: pay!.id } })).qboId).toBe("P1");
    expect(await syncPayment(pay!.id)).toBe("P1");
    await prisma.integrationConnection.deleteMany({ where: { provider: "QUICKBOOKS" } });
    await saveSettings({ qboItemId: null }, a);
  });
});
