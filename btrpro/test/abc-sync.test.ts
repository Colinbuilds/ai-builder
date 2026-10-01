// TEST_ONLY ABC Supply background sync: pages through order and invoice history, matches jobs by PO, upserts.
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { syncAbc } from "@/lib/integrations/abc";
import { saveSettings } from "@/lib/settings";

const SYS = { id: "", name: "TEST_ONLY" };
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await prisma.supplierFeed.deleteMany({ where: { provider: "ABC_SUPPLY", number: { startsWith: "TESTONLY" } } });
  await prisma.integrationConnection.deleteMany({ where: { provider: "ABC_SUPPLY", accountLabel: "TEST_ONLY" } });
  await prisma.project.deleteMany({ where: { name: "TEST_ONLY ABC job" } });
  await saveSettings({ abcBillTo: null, abcSyncedAt: null, abcSyncError: null }, SYS);
});

describe("ABC Supply sync", () => {
  it("reads orders (two pages) and invoices, matches a job by PO number", async () => {
    await prisma.integrationConnection.deleteMany({ where: { provider: "ABC_SUPPLY", userId: null } });
    await prisma.integrationConnection.create({ data: { provider: "ABC_SUPPLY", userId: null, accountLabel: "TEST_ONLY", accessToken: encrypt("tok"), expiresAt: new Date(Date.now() + 3600_000) } });
    const job = await prisma.project.create({ data: { name: "TEST_ONLY ABC job", market: "RESIDENTIAL", status: "SOLD", qboJobNo: "TESTPO-77" } as never });
    await saveSettings({ abcBillTo: "TEST123" }, SYS);
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (u: string, init: { headers: Record<string, string> }) => {
      urls.push(u);
      expect(init.headers.authorization).toBe("Bearer tok");
      const page = Number(new URL(u).searchParams.get("pageNumber"));
      const body = u.includes("/orders/orderHistory")
        ? { pagination: { totalPages: 2 }, items: [{ orderNumber: `TESTONLY-O${page}`, orderStatus: "Delivered", branchCityState: "Omaha, NE", invoiceDate: "2026-09-01" }] }
        : { pagination: { totalPages: 1 }, items: [{ invoiceNumber: "TESTONLY-I1", invoiceDate: "2026-09-02", purchaseOrderNumber: "TESTPO-77", orderName: "Smith reroof", total: 1234.5 }] };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const r = await syncAbc();
    expect(r).toMatchObject({ orders: 2, invoices: 1 });
    expect(urls.some((u) => u.includes("/api/invoice/v1/invoices/history/TEST123"))).toBe(true);
    const inv = await prisma.supplierFeed.findFirstOrThrow({ where: { number: "TESTONLY-I1" } });
    expect(inv).toMatchObject({ kind: "INVOICE", total: 1234.5, projectId: job.id, poNumber: "TESTPO-77" });
    // running again updates rather than duplicating
    await syncAbc();
    expect(await prisma.supplierFeed.count({ where: { number: { startsWith: "TESTONLY" } } })).toBe(3);
  });
});
