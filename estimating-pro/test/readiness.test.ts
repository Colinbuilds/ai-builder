// Acceptance test 12: BID_READY can't be reached with any MISSING, PLACEHOLDER, or PENDING_AI line,
// unapproved waste, or an EXPIRED sheet.
import { describe, expect, it } from "vitest";
import { computeReadiness, type ReadinessInput } from "@/lib/projects/readiness";

const clean = (): ReadinessInput => ({
  projectId: "p1",
  intake: [{ key: "roof_area", label: "Roof area", status: "VERIFIED" }],
  estimate: {
    id: "e1",
    name: "Rev 1",
    wasteApproved: true,
    lines: [{ id: "l1", itemName: "Vista AR 252", sourceStatus: "VERIFIED", sheetStatus: "STALE" }],
    labor: [{ id: "b1", task: "Tear-off and install", sourceStatus: "VERIFIED" }],
  },
  expiredSheets: [],
});
const withLine = (sourceStatus: string, sheetStatus: string | null = "CURRENT") => {
  const i = clean();
  i.estimate!.lines.push({ id: "l2", itemName: "Cap nails", sourceStatus, sheetStatus });
  return i;
};

describe("computeReadiness", () => {
  it("is BID_READY only when nothing is missing or assumed (a STALE sheet alone doesn't block)", () => {
    expect(computeReadiness(clean())).toEqual({ readiness: "BID_READY", blockers: [] });
  });

  it.each(["MISSING", "MISSING_ITEM", "MISSING_PRICE", "CALL_FOR_PRICE", "PENDING_AI"])("%s line → NOT_READY", (s) => {
    const r = computeReadiness(withLine(s));
    expect(r.readiness).toBe("NOT_READY");
    expect(r.blockers[0]).toMatchObject({ severity: "blocks_number", href: "/projects/p1/estimates/e1#line-l2" });
  });

  it.each(["PLACEHOLDER", "ASSUMPTION_APPROVED"])("%s line → BUDGET, never BID_READY", (s) => {
    expect(computeReadiness(withLine(s)).readiness).toBe("BUDGET");
  });

  it("unapproved waste → BUDGET", () => {
    const i = clean();
    i.estimate!.wasteApproved = false;
    expect(computeReadiness(i).readiness).toBe("BUDGET");
  });

  it("a line priced from an EXPIRED sheet → NOT_READY", () => {
    expect(computeReadiness(withLine("VERIFIED", "EXPIRED")).readiness).toBe("NOT_READY");
  });

  it("any EXPIRED live sheet → NOT_READY", () => {
    const i = clean();
    i.expiredSheets = ["SS BTR - Steep Slope"];
    expect(computeReadiness(i).readiness).toBe("NOT_READY");
  });

  it("MISSING intake → NOT_READY; ASSUMED intake → BUDGET", () => {
    const a = clean();
    a.intake[0].status = "MISSING";
    expect(computeReadiness(a).readiness).toBe("NOT_READY");
    const b = clean();
    b.intake[0].status = "ASSUMED";
    expect(computeReadiness(b).readiness).toBe("BUDGET");
  });

  it("no estimate, or no/missing labor → NOT_READY", () => {
    expect(computeReadiness({ ...clean(), estimate: null }).readiness).toBe("NOT_READY");
    const i = clean();
    i.estimate!.labor = [];
    expect(computeReadiness(i).readiness).toBe("NOT_READY");
    const j = clean();
    j.estimate!.labor[0].sourceStatus = "MISSING";
    expect(computeReadiness(j).readiness).toBe("NOT_READY");
  });
});
