// Database backups. Every night after 2 AM Central a full copy of the database is written next to it
// (/data/backups/btrpro-YYYY-MM-DD-HHMM.db) with SQLite's VACUUM INTO — a consistent copy while the app keeps
// running — and the last 14 are kept. When an S3-compatible bucket is set up (BACKUP_S3_BUCKET, or the uploads
// bucket) each copy also goes there, so a lost volume isn't a lost company. Admins can see, download and start one.
import { mkdir, readdir, rm, stat, readFile } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/db";
import { central } from "@/lib/bids/parse";

export const KEEP = 14;
const NAME = /^btrpro-(\d{4}-\d{2}-\d{2})-(\d{4})\.db$/;

/** The SQLite file the app runs on (null on another database). */
export function dbFile(): string | null {
  const url = process.env.DATABASE_URL ?? "file:/data/btrpro.db";
  if (!url.startsWith("file:")) return null;
  const f = url.slice(5);
  return path.isAbsolute(f) ? f : path.resolve(process.cwd(), "prisma", f);
}
export const backupDir = () => process.env.BACKUP_DIR ?? path.join(path.dirname(dbFile() ?? "/data/x"), "backups");

// off-site only to a bucket of its own (never the uploads bucket, which may serve files publicly)
const offsite = () => {
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!bucket) return null;
  return {
    bucket,
    client: (client ??= new S3Client({
      region: process.env.S3_REGION || "auto",
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: !!process.env.S3_ENDPOINT,
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" },
    })),
  };
};
let client: S3Client | null = null;
export const offsiteConfigured = () => !!offsite();

export type BackupFile = { name: string; bytes: number; at: Date };

export async function listBackups(): Promise<BackupFile[]> {
  const dir = backupDir();
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: BackupFile[] = [];
  for (const n of names) {
    if (!NAME.test(n)) continue;
    const s = await stat(path.join(dir, n)).catch(() => null);
    if (s) out.push({ name: n, bytes: s.size, at: s.mtime });
  }
  return out.sort((a, b) => b.name.localeCompare(a.name));
}

const stamp = (d: Date) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}-${g("hour").replace("24", "00")}${g("minute")}`;
};

/** Write a backup now; prune to the newest KEEP; copy off-site when a bucket is set up. */
export async function backupNow(now = new Date()): Promise<{ file: BackupFile; offsite: "sent" | "not set up" | string }> {
  if (!dbFile()) throw new Error("Backups here are for the SQLite database; this server runs on another database.");
  const dir = backupDir();
  await mkdir(dir, { recursive: true });
  const name = `btrpro-${stamp(now)}.db`;
  const target = path.join(dir, name);
  await rm(target, { force: true });
  // a consistent copy while the app keeps writing (no locks held for long, no half-written pages)
  await prisma.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  const s = await stat(target);
  const all = await listBackups();
  for (const old of all.slice(KEEP)) await rm(path.join(dir, old.name), { force: true });
  let sent: "sent" | "not set up" | string = "not set up";
  const o = offsite();
  if (o) {
    try {
      await o.client.send(new PutObjectCommand({ Bucket: o.bucket, Key: `backups/${name}`, Body: await readFile(target) }));
      sent = "sent";
    } catch (e) {
      sent = `failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
    }
  }
  await prisma.auditLog.create({ data: { entity: "Backup", entityId: name, action: "backup", after: { bytes: s.size, offsite: sent } } }).catch(() => null);
  return { file: { name, bytes: s.size, at: s.mtime }, offsite: sent };
}

/** Due when there's no backup from tonight (after 2 AM Central) yet. */
export function backupDue(latest: Date | null, now = new Date()) {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(now).split("-").map(Number);
  const twoAm = central(y, m, d, 2, 0);
  if (now < twoAm) return false;
  return !latest || latest < twoAm;
}

let watching = false;
/** Nightly backups run only for the server's database on its volume (or where BACKUP_DIR says) — never a local copy. */
export const backupsOn = () => !!dbFile() && (!!process.env.BACKUP_DIR || dbFile()!.startsWith("/data/"));

export function startBackupWatcher(everyMs = 30 * 60_000) {
  if (watching || !backupsOn()) return;
  watching = true;
  const run = async () => {
    try {
      const latest = (await listBackups())[0]?.at ?? null;
      if (!backupDue(latest)) return;
      const r = await backupNow();
      console.log(`[backup] ${r.file.name} (${Math.round(r.file.bytes / 1024)} KB), off-site ${r.offsite}`);
    } catch (e) {
      console.error("[backup] failed:", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(run, 90_000);
  setInterval(run, everyMs);
}

/** A backup file's path, only for a real backup name (no path tricks). */
export function backupPath(name: string) {
  if (!NAME.test(name)) return null;
  return path.join(backupDir(), name);
}

// ---------- how much room the data takes ----------
async function folderBytes(dir: string, budget = { files: 200_000 }): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (budget.files-- <= 0) break;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = await folderBytes(p, budget);
      bytes += sub.bytes;
      files += sub.files;
    } else if (e.isFile()) {
      bytes += (await stat(p).catch(() => null))?.size ?? 0;
      files++;
    }
  }
  return { bytes, files };
}

/** Database, uploaded files, backups, and the disk they're on. Null parts aren't on this server (e.g. uploads in a bucket). */
export async function storageUse() {
  const db = dbFile();
  const dbBytes = db ? ((await stat(db).catch(() => null))?.size ?? 0) : null;
  const uploads = process.env.STORAGE_DRIVER === "s3" ? null : await folderBytes(path.resolve(process.env.UPLOAD_DIR ?? "uploads"));
  const backups = (await listBackups()).reduce((a, b) => a + b.bytes, 0);
  const { statfs } = await import("node:fs/promises");
  const fs = await statfs(path.dirname(db ?? process.cwd())).catch(() => null);
  return {
    database: dbBytes,
    uploads,
    backups,
    disk: fs ? { total: fs.blocks * fs.bsize, free: fs.bavail * fs.bsize } : null,
  };
}
