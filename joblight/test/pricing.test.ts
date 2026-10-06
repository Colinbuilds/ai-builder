import { describe, expect, it } from "vitest";
import { buildoutMonthly, monthlyFor, userRate } from "@/lib/pricing";

describe("pricing schedule", () => {
  it("first user is the base rate, each next one 5% less, never under the floor", () => {
    expect(userRate(1)).toBe(99);
    expect(userRate(2)).toBe(94.05);
    expect(userRate(20)).toBe(40);
    for (let n = 2; n <= 20; n++) expect(userRate(n)).toBeLessThanOrEqual(userRate(n - 1));
  });

  it("totals match the published table", () => {
    expect(monthlyFor(1)).toBe(99);
    expect(Math.round(monthlyFor(5)!)).toBe(448);
    expect(Math.round(monthlyFor(10)!)).toBe(795);
    expect(Math.round(monthlyFor(20)!)).toBe(1274);
  });

  it("over 20 users is a custom quote; bad input is refused", () => {
    expect(monthlyFor(21)).toBeNull();
    expect(() => monthlyFor(0)).toThrow();
  });

  it("buildouts bill the agreed rate, else the schedule; paused and cancelled bill nothing", () => {
    expect(buildoutMonthly({ users: 5, customMonthly: null, status: "LIVE" })).toBe(monthlyFor(5));
    expect(buildoutMonthly({ users: 30, customMonthly: 1800, status: "LIVE" })).toBe(1800);
    expect(buildoutMonthly({ users: 30, customMonthly: null, status: "LIVE" })).toBeNull();
    expect(buildoutMonthly({ users: 5, customMonthly: null, status: "PAUSED" })).toBe(0);
  });
});
