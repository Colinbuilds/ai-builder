// The seed loads BTR's /data files only for BTR's deployment. Another company's fresh database gets the admin user
// and nothing else of BTR's. Runs the real seed against throwaway TEST_ONLY databases.
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { seedsBtrData } from "@/lib/seed-mode";

describe("who gets BTR's data", () => {
  it("decides from SEED_COMPANY, then the saved profile, then whether the database is BTR's existing one", () => {
    expect(seedsBtrData({ env: "btr", profileName: null, hasData: false })).toBe(true);
    expect(seedsBtrData({ env: " BTR ", profileName: null, hasData: false })).toBe(true);
    expect(seedsBtrData({ env: "blank", profileName: null, hasData: true })).toBe(false);
    expect(seedsBtrData({ env: "TEST_ONLY Acme", profileName: null, hasData: true })).toBe(false);
    // BTR's live database (users, sheets) keeps loading with nothing set
    expect(seedsBtrData({ env: undefined, profileName: null, hasData: true })).toBe(true);
    expect(seedsBtrData({ env: undefined, profileName: "BTR Contracting", hasData: true })).toBe(true);
    // another company's profile, or a brand-new database: never
    expect(seedsBtrData({ env: undefined, profileName: "TEST_ONLY Acme", hasData: true })).toBe(false);
    expect(seedsBtrData({ env: "", profileName: null, hasData: false })).toBe(false);
  });
});

describe("seed on a fresh database", () => {
  const root = path.resolve(__dirname, "..");
  const run = (name: string, extra: Record<string, string>) => {
    const file = path.join(root, "prisma", `${name}.db`);
    rmSync(file, { force: true });
    const { SEED_COMPANY: _ignored, ...base } = process.env;
    const env = { ...base, DATABASE_URL: `file:./${name}.db`, SEED_ADMIN_EMAIL: "test-only-admin@example.com", ...extra };
    execSync("npx prisma db push --skip-generate", { cwd: root, env, stdio: "pipe" });
    execSync("npx tsx prisma/seed.ts", { cwd: root, env, stdio: "pipe" });
    return { db: new PrismaClient({ datasources: { db: { url: `file:${file}` } } }), file };
  };
  const counts = (db: PrismaClient) =>
    Promise.all([db.priceSheet.count(), db.priceItem.count(), db.rule.count(), db.estimateTemplate.count(), db.crew.count(), db.company.count(), db.laborStandard.count(), db.companySetting.count(), db.user.count()]);

  it("another company (no SEED_COMPANY) gets only its admin user", async () => {
    const { db, file } = run("seed-blank-test", {});
    try {
      expect(await counts(db)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1]);
      expect(await db.user.findFirst({ select: { email: true, role: true } })).toEqual({ email: "test-only-admin@example.com", role: "ADMIN" });
    } finally {
      await db.$disconnect();
      rmSync(file, { force: true });
    }
  }, 120_000);

  it("SEED_COMPANY=btr loads BTR's library as before", async () => {
    const { db, file } = run("seed-btr-test", { SEED_COMPANY: "btr" });
    try {
      const [sheets, items, rules] = await counts(db);
      expect(sheets).toBeGreaterThanOrEqual(6);
      expect(items).toBe(527);
      expect(rules).toBe(16);
    } finally {
      await db.$disconnect();
      rmSync(file, { force: true });
    }
  }, 120_000);
});
