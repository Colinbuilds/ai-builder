// TEST_ONLY ideas board
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addIdea, hoursPerMonth, ideasForClaude, setIdeaStatus, toggleVote } from "@/lib/ideas/service";

afterAll(() => prisma.$disconnect());

describe("ideas board", () => {
  it("adds, votes, estimates time back, and lists open ideas for Claude", async () => {
    const a = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    await expect(addIdea({ title: "", details: "x", often: "DAILY", minutes: 5, area: null }, a)).rejects.toThrow(/title/);
    const i = await addIdea({ title: "TEST_ONLY deposit invoice from proposal", details: "TEST_ONLY I retype the job in QuickBooks", often: "DAILY", minutes: 10, area: "QuickBooks" }, a);
    expect(i.votes).toEqual([a.id]);
    expect(hoursPerMonth(i)).toBe(3.3);
    await toggleVote(i.id, a);
    expect((await prisma.idea.findUniqueOrThrow({ where: { id: i.id } })).votes).toEqual([]);
    expect(await ideasForClaude()).toContain("TEST_ONLY deposit invoice from proposal");
    await setIdeaStatus(i.id, "DONE", "Live now");
    expect(await ideasForClaude()).not.toContain("TEST_ONLY deposit invoice from proposal");
  });
});
