// TEST_ONLY code & spec research: official-only restricts the web tools, a paused turn resumes, sources are
// deduplicated, and the job's spec book goes along as context.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { setAiClientForTests } from "@/lib/ai/claude";
import { askCodeQuestion, isOfficial, OFFICIAL_DOMAINS } from "@/lib/codes/library";

afterAll(async () => {
  setAiClientForTests(null);
  const p = await prisma.project.findMany({ where: { name: "TEST_ONLY Code job" }, select: { id: true } });
  await prisma.codeQuestion.deleteMany({ where: { question: { startsWith: "TEST_ONLY" } } });
  await prisma.document.deleteMany({ where: { projectId: { in: p.map((x) => x.id) } } });
  await prisma.project.deleteMany({ where: { name: "TEST_ONLY Code job" } });
});

describe("code & spec research", () => {
  it("researches with official domains, resumes a paused turn, keeps cited sources", async () => {
    const job = await prisma.project.create({ data: { name: "TEST_ONLY Code job", market: "COMMERCIAL" } });
    await prisma.document.create({ data: { projectId: job.id, type: "SPECS", fileName: "TEST_ONLY spec.pdf", fileUrl: "x", extractedText: "SECTION 07 54 23 TPO: 60 mil, fully adhered", source: "UPLOAD" } });
    const calls: { tools: { allowed_domains?: string[] }[]; messages: { content: unknown }[] }[] = [];
    const cite = { type: "web_search_result_location", url: "https://up.codes/viewer/omaha/irc-2018/chapter/9", title: "IRC 2018 Ch 9", cited_text: "R905.1.2 Ice barriers" };
    setAiClientForTests({
      beta: {
        messages: {
          create: async (b: never) => {
            calls.push(b);
            return calls.length === 1
              ? { stop_reason: "pause_turn", model: "fake", content: [{ type: "text", text: "Looking… ", citations: [cite] }] }
              : { stop_reason: "end_turn", model: "fake", content: [{ type: "text", text: "Ice barrier required where there's a history of ice damming (R905.1.2).", citations: [cite, { ...cite, url: "https://www.gaf.com/x.pdf", title: "GAF" }] }] };
          },
        },
      },
    } as never);
    const q = await askCodeQuestion({ question: "TEST_ONLY ice barrier at eaves?", jurisdiction: "Omaha, NE", projectId: job.id, officialOnly: true, useJobSpecs: true }, { name: "TEST_ONLY" });
    expect(calls).toHaveLength(2);
    expect(calls[0].tools[0].allowed_domains).toEqual(OFFICIAL_DOMAINS);
    expect(JSON.stringify(calls[0].messages[0].content)).toMatch(/07 54 23/);
    expect(q.answer).toMatch(/R905\.1\.2/);
    expect((q.sources as { url: string }[]).map((s) => s.url)).toEqual(["https://up.codes/viewer/omaha/irc-2018/chapter/9", "https://www.gaf.com/x.pdf"]);
  });

  it("marks official sources", () => {
    expect(isOfficial("https://codes.iccsafe.org/content/IRC2018")).toBe(true);
    expect(isOfficial("https://www.reddit.com/r/roofing")).toBe(false);
  });
});
