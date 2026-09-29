import { describe, expect, it } from "vitest";
import { checkStageChange, nextForm17Status, showForm17Banner, type GateInput } from "@/lib/projects/workflow";
import { INTAKE_FIELDS, reconcileIntake } from "@/lib/projects/intake";

const base: GateInput = {
  from: "ESTIMATING",
  to: "SUBMITTED",
  readiness: "BID_READY",
  form17Status: "NOT_REQUIRED",
  contractAmount: null,
  contractSignedAt: null,
};

describe("stage gates", () => {
  it("blocks submitting a NOT_READY estimate unless overridden with a reason", () => {
    const r = checkStageChange({ ...base, readiness: "NOT_READY" });
    expect(r).toMatchObject({ ok: false, overridable: true });
    expect(checkStageChange({ ...base, readiness: "NOT_READY", override: true })).toMatchObject({ ok: false });
    expect(checkStageChange({ ...base, readiness: "NOT_READY", override: true, reason: "GC wants a number today" })).toEqual({
      ok: true,
      overridden: true,
    });
    expect(checkStageChange({ ...base, readiness: "BUDGET" })).toEqual({ ok: true, overridden: false });
  });

  it("needs a contract amount to mark Sold and a signed contract to schedule", () => {
    expect(checkStageChange({ ...base, from: "SUBMITTED", to: "SOLD" })).toMatchObject({ ok: false });
    expect(checkStageChange({ ...base, from: "SUBMITTED", to: "SOLD", contractAmount: 1 }).ok).toBe(true);
    const r = checkStageChange({ ...base, from: "SOLD", to: "SCHEDULED", contractAmount: 1 });
    expect(r.ok ? [] : r.problems).toEqual(["A signed contract is required before scheduling."]);
  });

  it("PUB-01: can't schedule a public tax-exempt job until Form 17 is executed, and it can't be overridden", () => {
    const g = { ...base, from: "SOLD" as const, to: "SCHEDULED" as const, contractAmount: 1, contractSignedAt: new Date() };
    const r = checkStageChange({ ...g, form17Status: "PENDING", override: true, reason: "rush" });
    expect(r).toMatchObject({ ok: false, overridable: false });
    expect(checkStageChange({ ...g, form17Status: "EXECUTED" }).ok).toBe(true);
  });

  it("LOST needs a reason and isn't allowed once sold; moving backward needs a reason", () => {
    expect(checkStageChange({ ...base, to: "LOST" }).ok).toBe(false);
    expect(checkStageChange({ ...base, to: "LOST", reason: "Low bidder was 8% under" }).ok).toBe(true);
    expect(checkStageChange({ ...base, from: "SOLD", to: "LOST", reason: "x", contractAmount: 1 }).ok).toBe(false);
    expect(checkStageChange({ ...base, from: "SUBMITTED", to: "ESTIMATING" }).ok).toBe(false);
    expect(checkStageChange({ ...base, from: "SUBMITTED", to: "ESTIMATING", reason: "Addendum 2" }).ok).toBe(true);
  });
});

describe("Form 17 status", () => {
  it("is required exactly for public + tax-exempt jobs and stays executed once executed", () => {
    expect(nextForm17Status(true, true, "NOT_REQUIRED")).toBe("PENDING");
    expect(nextForm17Status(true, false, "PENDING")).toBe("NOT_REQUIRED");
    expect(nextForm17Status(true, true, "EXECUTED")).toBe("EXECUTED");
    expect(showForm17Banner({ isPublic: true, isTaxExempt: true, form17Status: "PENDING" })).toBe(true);
    expect(showForm17Banner({ isPublic: true, isTaxExempt: true, form17Status: "EXECUTED" })).toBe(false);
  });
});

describe("intake relevance", () => {
  it("has all 20 CLAUDE.md §4 fields", () => {
    expect(INTAKE_FIELDS).toHaveLength(20);
  });

  it("marks out-of-scope fields N/A automatically and brings them back when the scope changes", () => {
    const steep = reconcileIntake([], { scopes: ["STEEP"], constructionType: "REROOF" });
    const st = (k: string, s = steep) => s.find((f) => f.key === k)!;
    expect(st("roof_area").status).toBe("MISSING");
    expect(st("existing_roof_layers").status).toBe("MISSING");
    expect(st("siding_type")).toMatchObject({ status: "NOT_APPLICABLE", autoNa: true });
    const both = reconcileIntake(steep, { scopes: ["STEEP", "SIDING"], constructionType: "REROOF" });
    expect(st("siding_type", both)).toMatchObject({ status: "MISSING", autoNa: false });
    const newBuild = reconcileIntake(steep, { scopes: ["STEEP"], constructionType: "NEW" });
    expect(st("existing_roof_layers", newBuild).status).toBe("NOT_APPLICABLE");
  });

  it("never changes a status a person set", () => {
    const s = reconcileIntake([{ key: "siding_type", status: "VERIFIED", autoNa: false }], { scopes: ["STEEP"], constructionType: null });
    expect(s.find((f) => f.key === "siding_type")!.status).toBe("VERIFIED");
  });
});
