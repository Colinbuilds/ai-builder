// TEST_ONLY receipts, jobs and a TEST_ONLY builder price sheet. The AI is faked.
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { setAiClientForTests } from "@/lib/ai/claude";
import { createProject } from "@/lib/projects/service";
import { lineAmount, matchReceiptJob, priceCheckLine, receiptPricing, totalsCheck, type Receipt, type SheetPrice } from "@/lib/receipts/check";
import { approveReceipt, fileReceipt, loadReceipt, scanReceipt } from "@/lib/receipts/service";
import { receiptsFromEmail } from "@/lib/receipts/inbox";

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
    // BTR writes the job name in the PO: a PO that spells out one job's name is a 95% match
    expect(matchReceiptJob(receipt({ poNumber: "PRAIRIE RIDGE LOT 7" }), jobs, orders).match).toMatchObject({ projectId: "j2", score: 95 });
    // a name in the job-name field alone is never enough to file automatically: it waits for review
    const byName = matchReceiptJob(receipt({ jobName: "prairie" }), jobs, orders);
    expect(byName.match).toBeNull();
    expect(byName.candidates[0]).toMatchObject({ projectId: "j2", score: 85 });
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

describe("pricing for the customer (Colin's JobReceipts numbers)", () => {
  it("spreads the tax over the lines by amount, then marks each line up", () => {
    // Receipt 1 in the design: ABC, $1,055.98 + $73.92 tax, 15% markup
    const abc = receiptPricing([510, 238, 179.98, 128], 73.92, [15, 15, 15, 15]);
    expect(abc.lines.map((l) => l.cost)).toEqual([545.7, 254.66, 192.58, 136.96]);
    expect(abc.cost).toBe(1129.9);
    expect(abc.lines.map((l) => l.billed)).toEqual([627.56, 292.86, 221.47, 157.5]);
    // Receipt 2: Home Depot
    const hd = receiptPricing([167.94, 79.84, 44.9], 20.49, [15, 15, 15]);
    expect(hd.lines.map((l) => l.cost)).toEqual([179.7, 85.43, 48.04]);
    // 179.70 × 1.15 = 206.655 → $206.66 (the design mockup shows $206.65 from a floating-point slip)
    expect(hd.lines.map((l) => l.billed)).toEqual([206.66, 98.24, 55.25]);
    expect(hd).toMatchObject({ cost: 313.17, billed: 360.15, profit: 46.98, marginPct: 13.04 });
    // a line can carry its own markup
    expect(receiptPricing([100], null, [25]).lines[0]).toMatchObject({ cost: 100, billed: 125, profit: 25 });
  });

  it("ABC delivery ticket to the shop: the shop address is ignored, the PO (customer name) finds the job", () => {
    const jobs = [
      { id: "wc", name: "TEST_ONLY Wylie Clang", address: "1500 Test Oak Dr, Elkhorn NE", status: "SOLD", acculynxJobNumber: null, clientName: null },
      { id: "shopjob", name: "TEST_ONLY Shop stock", address: "2755 River Rd, Waterloo NE", status: "SOLD", acculynxJobNumber: null, clientName: null },
    ];
    const t = matchReceiptJob(receipt({ documentType: "DELIVERY_TICKET", poNumber: "Wylie Clang", shipToName: "BTR Contracting-Shop", shipToAddress: "2755 River Rd Waterloo, NE 68127-6812" }), jobs, [], { ownAddresses: ["10852 Hanover St", "9350 G Ct", "2755 River Rd"] });
    expect(t.match).toMatchObject({ projectId: "wc", score: 95 });
  });

  it("matches from the email note, and holds a name-only match for review", () => {
    const jobs = [
      { id: "w", name: "TEST_ONLY Dana Whitfield", address: "4410 Maple Ridge Dr, Omaha NE", status: "SOLD", acculynxJobNumber: null, clientName: null },
      { id: "n1", name: "TEST_ONLY Northgate Commons Office Building", address: "1 Commons Way", status: "SOLD", acculynxJobNumber: null, clientName: null },
      { id: "n2", name: "TEST_ONLY Northgate Plaza Retail Center", address: "2 Plaza Way", status: "SOLD", acculynxJobNumber: null, clientName: null },
    ];
    const w = matchReceiptJob(receipt({ jobName: "Whitfield" }), jobs, [], { subject: "Whitfield roof - extra materials", message: "Picked up 12 bdl for the back slope at Whitfield, 4410 Maple Ridge." });
    expect(w.match).toMatchObject({ projectId: "w", score: 100 });
    const n = matchReceiptJob(receipt(), jobs, [], { subject: "receipt", message: "northgate job" });
    expect(n.match).toBeNull();
    expect(n.candidates.map((c) => c.projectId).sort()).toEqual(["n1", "n2"]);
  });
});

describe("approve: cost only, change order, invoice", () => {
  const fakeRead = (r: Receipt) =>
    setAiClientForTests({ beta: { messages: { parse: async () => ({ stop_reason: "end_turn", model: "fake", parsed_output: r }) } } } as never);
  const img = async () => new Uint8Array(await sharp({ create: { width: 30, height: 40, channels: 3, background: "#fff" } }).jpeg().toBuffer());
  async function setup(address: string, contract: number | null, status: "SOLD" | "LEAD" = "SOLD") {
    const a = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const actor = { id: a.id, name: a.name, role: "ADMIN" as const };
    const job = await createProject({ name: `TEST_ONLY approve ${address}`, scopes: ["STEEP"], isPublic: false, isTaxExempt: false, address }, actor);
    await prisma.project.update({ where: { id: job.id }, data: { status, contractAmount: contract } });
    return { actor, job };
  }
  const lines = (n: string) => [
    { itemNumber: null, description: `TEST_ONLY OSB ${n}`, quantity: 14, uom: "SHT", unitPrice: 17, extendedPrice: 238 },
    { itemNumber: null, description: `TEST_ONLY nails ${n}`, quantity: 2, uom: "BX", unitPrice: 64, extendedPrice: 128 },
  ];

  it("a change order bills the marked-up materials and files the real cost", async () => {
    const { actor, job } = await setup("6100 Birchwood Ct (TEST_ONLY)", 18450);
    fakeRead(receipt({ invoiceNumber: `TEST-CO-${job.id.slice(-5)}`, shipToAddress: "6100 Birchwood Ct", lines: lines("co"), tax: 25.62 }));
    const id = await scanReceipt([{ bytes: await img(), name: "r.jpg" }], actor, "Rotted decking on the back slope");
    const r = await approveReceipt(id, { projectId: job.id, outcome: "CHANGE_ORDER", markupPct: 15, lineMarkup: { "1": 20 }, reason: null }, actor);
    const co = await prisma.changeOrder.findUniqueOrThrow({ where: { id: r.changeOrderId! } });
    // costs 254.66 + 136.96 (tax spread); billed 292.86 (15%) + 164.35 (20%)
    expect(co).toMatchObject({ status: "PENDING", amount: 457.21, costImpact: 391.62 });
    expect(co.description).toMatch(/Reason: Rotted decking/);
    expect((co.lines as unknown[]).length).toBe(2);
    expect(r.count).toBe(3);
    expect(r.qboStatus).toMatch(/isn't connected/);
    await expect(approveReceipt(id, { projectId: job.id, outcome: "COST_ONLY", markupPct: 15, lineMarkup: {}, reason: null }, actor)).rejects.toThrow(/already approved/);
  });

  it("an invoice needs a sold job; cost only bills nothing", async () => {
    const { actor, job } = await setup("6200 Birchwood Ct (TEST_ONLY)", 20000);
    fakeRead(receipt({ invoiceNumber: `TEST-INV-${job.id.slice(-5)}`, shipToAddress: "6200 Birchwood Ct", lines: lines("inv"), tax: null }));
    const id = await scanReceipt([{ bytes: await img(), name: "r.jpg" }], actor);
    const r = await approveReceipt(id, { projectId: job.id, outcome: "INVOICE", markupPct: 10, lineMarkup: {}, reason: "TEST_ONLY extra materials" }, actor);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: r.invoiceId! } });
    expect(inv).toMatchObject({ status: "DRAFT", subtotal: 402.6 });

    const lead = await setup("6300 Birchwood Ct (TEST_ONLY)", null, "LEAD");
    fakeRead(receipt({ invoiceNumber: `TEST-L-${lead.job.id.slice(-5)}`, shipToAddress: "6300 Birchwood Ct", lines: lines("lead"), tax: null }));
    const id2 = await scanReceipt([{ bytes: await img(), name: "r.jpg" }], lead.actor);
    await expect(approveReceipt(id2, { projectId: lead.job.id, outcome: "INVOICE", markupPct: 10, lineMarkup: {}, reason: null }, lead.actor)).rejects.toThrow(/isn't sold/);
    expect(await prisma.jobCost.count({ where: { projectId: lead.job.id } })).toBe(0);
    const ok = await approveReceipt(id2, { projectId: lead.job.id, outcome: "COST_ONLY", markupPct: 10, lineMarkup: {}, reason: null }, lead.actor);
    expect(ok).toMatchObject({ changeOrderId: null, invoiceId: null, count: 2 });
  });

  it("emailed receipts only come in from BTR staff or crew emails", async () => {
    const a = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    fakeRead(receipt({ lines: lines("mail") }));
    const att = [{ name: "r.jpg", contentType: "image/jpeg", bytes: Buffer.from(await img()) }];
    const base = { threadId: null, to: "receipts@example.com", subject: "TEST_ONLY Whitfield extra", sentAt: new Date(), bodyText: "Picked up more\n\nOn Mon someone wrote:\n> old", attachments: att };
    expect((await receiptsFromEmail({ ...base, externalId: "<test-1@x>", from: "Stranger <someone@example.com>" })).ignored).toMatch(/isn't a BTR/);
    const ok = await receiptsFromEmail({ ...base, externalId: `<test-2-${Date.now()}@x>`, from: `${a.name} <${a.email}>` });
    expect(ok.ids.length).toBe(1);
    const scan = await prisma.receiptScan.findUniqueOrThrow({ where: { id: ok.ids[0] } });
    expect(scan).toMatchObject({ source: "EMAIL", employeeId: a.id, message: "Picked up more" });
    await new Promise((r) => setTimeout(r, 300)); // let the background read finish
  });
});
