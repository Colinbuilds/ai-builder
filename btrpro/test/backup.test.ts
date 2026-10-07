// Database backups: a consistent copy, pruned to the newest 14, due once a night after 2 AM Central.
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { KEEP, backupDue, backupNow, backupPath, listBackups } from "@/lib/backup";

const dir = mkdtempSync(path.join(os.tmpdir(), "btr-backup-"));
process.env.BACKUP_DIR = dir;
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("backups", () => {
  it("is due once a night after 2 AM Central", () => {
    const at = (iso: string) => new Date(iso);
    expect(backupDue(null, at("2026-10-07T06:00:00Z"))).toBe(false); // 1 AM CDT
    expect(backupDue(null, at("2026-10-07T08:00:00Z"))).toBe(true); // 3 AM
    expect(backupDue(at("2026-10-07T07:30:00Z"), at("2026-10-07T20:00:00Z"))).toBe(false); // already ran tonight
    expect(backupDue(at("2026-10-06T07:30:00Z"), at("2026-10-07T20:00:00Z"))).toBe(true); // last one was yesterday
  });
  it("writes a readable copy and keeps the newest 14", async () => {
    for (let i = 0; i < KEEP + 3; i++) {
      const f = path.join(dir, `btrpro-2026-09-${String(i + 1).padStart(2, "0")}-0200.db`);
      writeFileSync(f, "old");
      utimesSync(f, new Date(2026, 8, i + 1), new Date(2026, 8, i + 1));
    }
    const r = await backupNow(new Date("2026-10-07T07:05:00Z"));
    expect(r.file.name).toBe("btrpro-2026-10-07-0205.db");
    expect(r.offsite).toBe("not set up");
    const list = await listBackups();
    expect(list).toHaveLength(KEEP);
    expect(list[0].name).toBe(r.file.name);
    // the copy is a working database with the same data
    const copy = new PrismaClient({ datasources: { db: { url: `file:${path.join(dir, r.file.name)}` } } });
    expect(await copy.user.count()).toBe(await prisma.user.count());
    await copy.$disconnect();
    expect(backupPath("../../etc/passwd")).toBeNull();
    expect(backupPath(r.file.name)).toBe(path.join(dir, r.file.name));
  });
});
