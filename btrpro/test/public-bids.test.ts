// TEST_ONLY public bids: parsers on saved copies of the real boards, relevance, distance, saving and triage.
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { setAiClientForTests } from "@/lib/ai/claude";
import { central, distance, parseCivic, parseIonWave, parseSdi, parseUsDate, relevance } from "@/lib/bids/parse";
import { addBidToSchedule, addSource, checkSource, decideBid, dueForCheck, mapSam, newBidCount, savePostings } from "@/lib/bids/service";

const fx = (n: string) => readFileSync(`test/fixtures/bids/${n}`, "utf8");
const who = { id: "", name: "TEST_ONLY bids" };

afterAll(async () => {
  setAiClientForTests(null);
  await prisma.estimateLog.deleteMany({ where: { updatedBy: who.name } });
  await prisma.bidSource.deleteMany({ where: { createdBy: who.name } });
  await prisma.$disconnect();
});

describe("parsers", () => {
  it("reads SDI's plan room", () => {
    const p = parseSdi(fx("sdi.html"));
    expect(p.length).toBeGreaterThan(50);
    const roof = p.find((x) => x.title === "Fremont Middle School 2027 Partial Roof Replacement")!;
    expect(roof.city).toBe("Fremont");
    expect(roof.state).toBe("NE");
    expect(roof.url).toBe("https://standarddigital.com/the-plan-room/fremont-middle-school-2027-partial-roof-replacement");
    expect(roof.dueAt?.toISOString()).toBe("2026-10-20T19:00:00.000Z"); // 2:00 PM CDT
    expect(p.find((x) => x.title.startsWith("Tekamah-Herman"))?.agency).toBe("Hausmann Construction (construction manager)");
  });

  it("reads an IonWave board", () => {
    const r = parseIonWave(fx("ionwave-omaha.html"), "https://douglascountypurchasing.ionwave.net/SourcingEvents.aspx?SourceType=1");
    expect(r.pages).toBe(1);
    expect(r.postings).toHaveLength(9);
    const s = r.postings.find((x) => x.title.includes("Downtown Soccer Stadium"))!;
    expect(s.number).toBe("CI-2026-0118 Addendum 4");
    expect(s.dueAt?.toISOString()).toBe("2026-10-07T16:00:00.000Z");
  });

  it("reads a CivicEngage bid page", () => {
    const p = parseCivic(fx("civic-fremont.html"), "https://www.fremontne.gov/Bids.aspx");
    expect(p.map((x) => x.title)).toContain("Waste Transfer Station RFP");
    expect(p[0].url).toBe("https://www.fremontne.gov/bids.aspx?bidID=432");
    expect(p[0].summary).not.toMatch(/Read on/);
  });

  it("dates, relevance and distance", () => {
    expect(central(2026, 12, 1, 14, 0).toISOString()).toBe("2026-12-01T20:00:00.000Z"); // CST
    expect(parseUsDate("10/8/2026")?.toISOString()).toBe("2026-10-08T22:00:00.000Z"); // no time → 5 PM
    expect(relevance("State of Nebraska Beatrice Transportation Building Re-Roof")).toBe("ROOFING");
    expect(relevance("UNK Men's Hall Exterior Window Replacement")).toBe("EXTERIOR");
    expect(relevance("Waverly Fire Station")).toBe("BUILDING");
    expect(relevance("Gretna Middle School HVAC and Lighting Upgrade")).toBe("OTHER");
    expect(relevance("I-80 Interchange - Northwest")).toBe("OTHER");
    expect(distance("Fremont", "NE")).toEqual({ miles: 31, nearest: "Omaha" });
    expect(distance("St. Paul", "NE")?.nearest).toBe("Lincoln");
    expect(distance("Council Bluffs", "IA")!.miles).toBeLessThan(10);
    expect(distance("Topeka", "KS")!.miles).toBeGreaterThan(125);
    expect(distance("Nowhereville", "NE")).toBeNull();
  });

  it("maps SAM.gov opportunities", () => {
    const p = mapSam({ noticeId: "abc", title: "Offutt AFB Bldg 301 Roof Replacement", solicitationNumber: "FA4600-26-R-0001", fullParentPathName: "DEPT OF DEFENSE.DEPT OF THE AIR FORCE.FA4600 55 CONS", responseDeadLine: "2026-11-01T14:00:00-05:00", placeOfPerformance: { city: { name: "Offutt AFB" }, state: { code: "NE" } } });
    expect(p.agency).toBe("DEPT OF THE AIR FORCE · FA4600 55 CONS");
    expect(p.dueAt?.toISOString()).toBe("2026-11-01T19:00:00.000Z");
    expect(p.url).toBe("https://sam.gov/opp/abc/view");
  });

  it("checks once a day after 5 AM Central", () => {
    const at = (iso: string) => new Date(iso);
    expect(dueForCheck(null, at("2026-10-02T09:00:00Z"))).toBe(false); // 4 AM CDT
    expect(dueForCheck(null, at("2026-10-02T11:00:00Z"))).toBe(true); // 6 AM
    expect(dueForCheck("2026-10-02T10:30:00Z", at("2026-10-02T20:00:00Z"))).toBe(false); // already ran today
    expect(dueForCheck("2026-10-01T15:00:00Z", at("2026-10-02T12:00:00Z"))).toBe(true);
  });
});

describe("saving and triage", () => {
  it("saves postings once, keys addenda together, marks gone, and adds to the schedule", async () => {
    await expect(addSource({ name: "x", kind: "PAGE", url: "https://www.buildersbureau.com/ipin", defaultCity: null, defaultState: null }, who)).rejects.toThrow(/members-only/);
    const src = await addSource({ name: "TEST_ONLY board", kind: "IONWAVE", url: "https://example.invalid/bids", defaultCity: "Omaha", defaultState: "NE" }, who);
    const due = new Date(Date.now() + 10 * 86_400_000);
    const n1 = await savePostings(src, [
      { title: "TEST_ONLY Library Re-Roof", number: "TO-1", dueAt: due },
      { title: "TEST_ONLY Sewer Cleaner", number: "TO-2", dueAt: due },
    ]);
    expect(n1).toBe(2);
    const before = await newBidCount();
    // same bid with an addendum is not new; TO-2 disappears from the board
    const n2 = await savePostings(src, [{ title: "TEST_ONLY Library Re-Roof", number: "TO-1 Addendum 1", dueAt: due }]);
    expect(n2).toBe(0);
    const bids = await prisma.publicBid.findMany({ where: { sourceId: src.id }, orderBy: { title: "asc" } });
    expect(bids.find((b) => b.number === "TO-1 Addendum 1")).toMatchObject({ relevance: "ROOFING", city: "Omaha", gone: false, miles: 6 });
    expect(bids.find((b) => b.number === "TO-2")?.gone).toBe(true);
    const roof = bids.find((b) => b.relevance === "ROOFING")!;
    await decideBid(roof.id, "WATCH", who);
    expect(await newBidCount()).toBe(before - 1);
    const logId = await addBidToSchedule(roof.id, who);
    const log = await prisma.estimateLog.findUniqueOrThrow({ where: { id: logId } });
    expect(log).toMatchObject({ board: "CURRENT", market: "COMMERCIAL", scope: "Roofing", project: "TEST_ONLY Library Re-Roof (Omaha, NE)" });
    expect(await addBidToSchedule(roof.id, who)).toBe(logId);
  });

  it("BTRbot reads any page, and skips the read when the page hasn't changed", async () => {
    let calls = 0;
    setAiClientForTests({
      beta: {
        messages: {
          parse: async () => {
            calls++;
            return { stop_reason: "end_turn", model: "test", parsed_output: { bids: [{ title: "TEST_ONLY Courthouse Roof", number: null, agency: "TEST_ONLY County", city: "Wahoo", state: "NE", dueDate: "2030-01-15", dueTime: "14:00", url: "/bid/7", summary: null }] } };
          },
        },
      },
    } as never);
    const src = await addSource({ name: "TEST_ONLY page", kind: "PAGE", url: "https://example.com/", defaultCity: null, defaultState: null }, who);
    const r1 = await checkSource(src.id);
    // example.com may be unreachable in CI; only assert the AI path when the fetch worked
    if (r1.ok) {
      expect(calls).toBe(1);
      const b = await prisma.publicBid.findFirstOrThrow({ where: { sourceId: src.id } });
      expect(b).toMatchObject({ title: "TEST_ONLY Courthouse Roof", relevance: "ROOFING", url: "https://example.com/bid/7" });
      expect(b.dueAt?.toISOString()).toBe("2030-01-15T20:00:00.000Z");
      await checkSource(src.id);
      expect(calls).toBe(1);
    }
  });
});
