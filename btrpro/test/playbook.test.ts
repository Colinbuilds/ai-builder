// TEST_ONLY playbook (SOPs): validation, review cycle, starter drafts.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { STARTERS, addStarters, markReviewed, reviewDue, saveSop } from "@/lib/playbook/service";

const who = { name: "TEST_ONLY playbook" };
afterAll(async () => {
  await prisma.sop.deleteMany({ where: { OR: [{ updatedBy: who.name }, { title: { in: STARTERS.map((s) => s.title) } }] } });
  await prisma.$disconnect();
});

describe("playbook", () => {
  it("validates, tracks review dates, and adds starters once", async () => {
    await expect(saveSop(null, { title: "", area: "OFFICE", ownerName: null, body: "1. x", reviewEveryMonths: 12, draft: true }, who)).rejects.toThrow(/title/);
    await expect(saveSop(null, { title: "TEST_ONLY x", area: "NOPE", ownerName: null, body: "1. long enough step text here", reviewEveryMonths: 12, draft: true }, who)).rejects.toThrow(/area/);
    const s = await saveSop(null, { title: "TEST_ONLY order materials", area: "PURCHASING", ownerName: "TEST_ONLY Pat", body: "1. Check the estimate quantities\n2. Send the PO", reviewEveryMonths: 6, draft: true }, who);
    expect(reviewDue(s).overdue).toBe(true); // never reviewed
    const r = await markReviewed(s.id, who);
    expect(r.draft).toBe(false);
    expect(reviewDue(r).overdue).toBe(false);
    expect(reviewDue(r, new Date(Date.now() + 200 * 86_400_000)).overdue).toBe(true);
    const n = await addStarters(who);
    expect(n).toBeGreaterThan(0);
    expect(await addStarters(who)).toBe(0);
  });
});
