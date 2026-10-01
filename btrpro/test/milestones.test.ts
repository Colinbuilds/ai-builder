import { describe, expect, it } from "vitest";
import { MILESTONES, milestoneOf, nextStage, prettyStages, stageMoveTitle } from "@/lib/projects/milestones";
import { STAGES } from "@/lib/projects/workflow";

describe("AccuLynx-style milestones", () => {
  it("puts every stage except Lost in exactly one milestone", () => {
    for (const s of STAGES) {
      const hits = MILESTONES.filter((m) => m.stages.includes(s));
      expect(hits.length).toBe(s === "LOST" ? 0 : 1);
    }
    expect(milestoneOf("SUBMITTED")?.label).toBe("Prospect");
    expect(milestoneOf("IN_PRODUCTION")?.label).toBe("Approved");
    expect(milestoneOf("PAID")?.label).toBe("Invoiced");
  });

  it("advances one stage at a time and stops at Closed or Lost", () => {
    expect(nextStage("LEAD")).toBe("ESTIMATING");
    expect(nextStage("PAID")).toBe("CLOSED");
    expect(nextStage("CLOSED")).toBeNull();
    expect(nextStage("LOST")).toBeNull();
  });

  it("writes stage names the way people read them", () => {
    expect(prettyStages("Pat moved the job LEAD → IN_PRODUCTION — rush")).toBe("Pat moved the job Lead → In production — rush");
    expect(prettyStages("LEADER stays")).toBe("LEADER stays");
    expect(stageMoveTitle({ from: "SUBMITTED", to: "SOLD" })).toBe("Moved to Sold");
    expect(stageMoveTitle(null)).toBeNull();
  });
});
