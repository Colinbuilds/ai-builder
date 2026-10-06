// TEST_ONLY long receipts: read page by page in parallel and put back together; reads cut off by a restart resume.
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { setAiClientForTests } from "@/lib/ai/claude";
import { mergePages, readLooksStuck, resumeStuckReads, saveReceiptFiles, scanReceipt } from "@/lib/receipts/service";

const ids: string[] = [];
afterAll(async () => {
  setAiClientForTests(null);
  await prisma.receiptScan.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

const page = (n: number, over: Record<string, unknown> = {}) => ({
  documentType: "INVOICE" as const,
  vendor: null,
  branch: null,
  invoiceNumber: null,
  orderNumber: null,
  poNumber: null,
  jobName: null,
  shipToName: null,
  shipToAddress: null,
  date: null,
  dueDate: null,
  terms: null,
  lines: [{ itemNumber: `TEST-${n}`, orderedQuantity: null, handwritten: false, description: `TEST_ONLY item p${n}`, quantity: n, uom: "EA", unitPrice: 1, extendedPrice: n }],
  subtotal: null,
  tax: null,
  total: null,
  notes: [],
  ...over,
});

describe("long receipts", () => {
  it("merges pages: header from the first page that has it, all lines in order, totals from the last", () => {
    const m = mergePages([page(1, { vendor: "TEST_ONLY Supply", invoiceNumber: "INV-1", subtotal: 99 }), page(2, { vendor: "ignored", notes: ["smudge"] }), page(3, { subtotal: 6, tax: 0.5, total: 6.5 })]);
    expect(m.vendor).toBe("TEST_ONLY Supply");
    expect(m.invoiceNumber).toBe("INV-1");
    expect(m.lines.map((l) => l.itemNumber)).toEqual(["TEST-1", "TEST-2", "TEST-3"]);
    expect([m.subtotal, m.tax, m.total]).toEqual([6, 0.5, 6.5]);
    expect(m.notes).toEqual(["Page 2: smudge"]);
  });

  it("reads a 6-page receipt one page per request, side by side", async () => {
    const a = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    let calls = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    setAiClientForTests({
      beta: {
        messages: {
          parse: async (req: { messages: { content: { type: string; text?: string }[] }[] }) => {
            calls++;
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((r) => setTimeout(r, 20));
            inFlight--;
            const text = req.messages[0].content.map((c) => c.text ?? "").join(" ");
            const n = Number(text.match(/This is page (\d+) of 6/)?.[1]);
            return { stop_reason: "end_turn", model: "fake", parsed_output: page(n, n === 1 ? { vendor: "TEST_ONLY Supply" } : n === 6 ? { total: 21 } : {}) };
          },
        },
      },
    } as never);
    const img = new Uint8Array(await sharp({ create: { width: 40, height: 60, channels: 3, background: "#fff" } }).jpeg().toBuffer());
    const id = await scanReceipt(Array.from({ length: 6 }, (_, i) => ({ bytes: img, name: `p${i + 1}.jpg` })), { id: a.id, name: a.name });
    ids.push(id);
    const s = await prisma.receiptScan.findUniqueOrThrow({ where: { id } });
    expect(s.status).toBe("READ");
    expect(calls).toBe(6);
    expect(maxInFlight).toBeGreaterThan(1);
    const r = s.extracted as { vendor: string; total: number; lines: { itemNumber: string }[] };
    expect(r.vendor).toBe("TEST_ONLY Supply");
    expect(r.total).toBe(21);
    expect(r.lines.map((l) => l.itemNumber)).toEqual(["TEST-1", "TEST-2", "TEST-3", "TEST-4", "TEST-5", "TEST-6"]);
  });

  it("spots a read cut off by a restart and reads it again", async () => {
    const a = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    setAiClientForTests({ beta: { messages: { parse: async () => ({ stop_reason: "end_turn", model: "fake", parsed_output: page(1, { vendor: "TEST_ONLY resumed" }) }) } } } as never);
    const img = new Uint8Array(await sharp({ create: { width: 40, height: 60, channels: 3, background: "#fff" } }).jpeg().toBuffer());
    const id = await saveReceiptFiles([{ bytes: img, name: "r.jpg" }], { source: "UPLOAD", employeeId: a.id, employee: a.name }, a.id);
    ids.push(id);
    const s = await prisma.receiptScan.findUniqueOrThrow({ where: { id } });
    expect(readLooksStuck(s)).toBe(false);
    expect(readLooksStuck(s, Date.now() + 6 * 60_000)).toBe(true);
    expect(await resumeStuckReads()).toBeGreaterThanOrEqual(1);
    expect((await prisma.receiptScan.findUniqueOrThrow({ where: { id } })).vendor).toBe("TEST_ONLY resumed");
  });
});
