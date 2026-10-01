import { describe, expect, it } from "vitest";
import { PLANS, commission } from "@/lib/costing/commission";

const plan = (k: string) => PLANS.find((p) => p.key === k)!;

describe("commission calculator", () => {
  it("10/60/40: 10% overhead, profit split 60 company / 40 rep", () => {
    // TEST_ONLY numbers
    const r = commission({ contract: 20000, jobCost: 12000, ...plan("10/60/40") });
    if (!r.ok) throw new Error("expected ok");
    expect(r.overhead).toBe(2000);
    expect(r.profit).toBe(6000);
    expect(r.rep).toBe(2400);
    expect(r.company).toBe(3600);
    expect(r.marginPct).toBe(30);
  });

  it("8/50/50: 8% overhead, even split", () => {
    const r = commission({ contract: 15000, jobCost: 9000, ...plan("8/50/50") });
    if (!r.ok) throw new Error("expected ok");
    expect(r.overhead).toBe(1200);
    expect(r.profit).toBe(4800);
    expect(r.rep).toBe(2400);
    expect(r.company).toBe(2400);
  });

  it("a job that loses money pays no commission and shows the loss", () => {
    const r = commission({ contract: 10000, jobCost: 9800, ...plan("10/60/40") });
    if (!r.ok) throw new Error("expected ok");
    expect(r.profit).toBe(-800);
    expect(r.lost).toBe(true);
    expect(r.rep).toBe(0);
    expect(r.company).toBe(0);
  });

  it("asks for what's missing instead of guessing", () => {
    const r = commission({ contract: NaN, jobCost: 100, overheadPct: 10, companyPct: 60, repPct: 30 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join(" ")).toMatch(/contract price.*add up to 100/);
  });
});
