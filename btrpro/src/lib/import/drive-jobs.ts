// Move jobs off Drive: every job folder in the company jobs drive becomes (or joins) a BTRpro job, and its files
// are copied into that job's Documents with their folder path ("Estimating › Proposals › …").
// Drive is only READ (the service account has drive.readonly) — nothing there is moved, renamed or deleted.
// Scan first (counts and size), then the background worker imports a few folders at a time until done.
import { prisma } from "@/lib/db";
import { getSettings, saveSettings } from "@/lib/settings";
import { addDocument } from "@/lib/docs/documents";
import { driveToken } from "@/lib/integrations/google-sa";
import { parseDriveLink } from "@/lib/integrations/drive";
import { createProject } from "@/lib/projects/service";
import { norm, scopesFor } from "@/lib/import/schedule";
import type { ProjectStatus } from "@prisma/client";

export const DEFAULT_JOBS_DRIVE = "0AOP9aD5U0hIrUk9PVA"; // BTR's shared drive of job folders
const API = "https://www.googleapis.com/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";
const SYSTEM = { id: "", name: "Drive job import" };
const IMPORTER = { id: null, name: "Drive job import" };
const MAX_BYTES = 50 * 1024 * 1024;
// plan-room boilerplate that rides along with plan downloads
const JUNK = /newsletter|printing these project files|sponsor a|^desktop\.ini$|^thumbs\.db$|^\.ds_store$/i;

type DFile = { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string; createdTime?: string };

async function api(token: string, url: string) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if ((r.status === 429 || r.status >= 500) && attempt < 4) {
      await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
      continue;
    }
    if (!r.ok) throw new Error(`Google Drive error ${r.status}`);
    return r;
  }
}

async function children(token: string, parent: string, extraQ = "") {
  const out: DFile[] = [];
  let pageToken = "";
  do {
    const q = new URLSearchParams({
      q: `'${parent}' in parents and trashed = false${extraQ}`,
      fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime,createdTime)",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      ...(pageToken ? { pageToken } : {}),
    });
    const j = await (await api(token, `${API}?${q}`)).json();
    out.push(...(j.files as DFile[]));
    pageToken = j.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

/** Every file under a folder, with its folder path; skips plan-room junk. */
async function walk(token: string, folderId: string, path: string[] = [], depth = 0): Promise<(DFile & { path: string[] })[]> {
  if (depth > 5) return [];
  const out: (DFile & { path: string[] })[] = [];
  for (const f of await children(token, folderId)) {
    if (f.mimeType === FOLDER) out.push(...(await walk(token, f.id, [...path, f.name.trim()], depth + 1)));
    else if (!JUNK.test(f.name) && f.mimeType !== "application/vnd.google-apps.shortcut") out.push({ ...f, path });
  }
  return out;
}

const cutoff = (months: number) => new Date(Date.now() - months * 30.5 * 86_400_000);

/** Finds the job folders changed or created in the window and records them (with file count and size). */
export async function scanDriveJobs() {
  const s = await getSettings();
  const token = await driveToken(null);
  const root = parseDriveLink(s.jobsDriveId ?? "") ?? s.jobsDriveId ?? DEFAULT_JOBS_DRIVE;
  const since = cutoff(s.driveImportMonths ?? 12).toISOString();
  const folders = (await children(token, root, ` and mimeType = '${FOLDER}' and (modifiedTime > '${since}' or createdTime > '${since}')`)).filter(
    (f) => !/old do not use|^z?archive$|^templates?$/i.test(f.name),
  );
  let found = 0;
  for (const f of folders) {
    const files = await walk(token, f.id);
    const totalBytes = files.reduce((a, x) => a + Number(x.size ?? 0), 0);
    await prisma.driveJobFolder.upsert({
      where: { folderId: f.id },
      create: { folderId: f.id, name: f.name.trim(), modifiedAt: f.modifiedTime ? new Date(f.modifiedTime) : null, fileCount: files.length, totalBytes },
      update: { name: f.name.trim(), modifiedAt: f.modifiedTime ? new Date(f.modifiedTime) : null, fileCount: files.length, totalBytes },
    });
    found++;
  }
  await saveSettings({ driveImportScannedAt: new Date().toISOString() }, SYSTEM);
  return { folders: found };
}

const BOARD_STATUS: Record<string, ProjectStatus> = { SOLD: "SOLD", LOST: "LOST", SENT: "SUBMITTED", CURRENT: "ESTIMATING", MISC: "ESTIMATING", REDRAW: "ESTIMATING", PASSING: "LOST" };

/** The BTRpro job for a folder: already linked, linked from the estimating schedule, same name/address, or new. */
export async function jobForFolder(folder: { folderId: string; name: string; modifiedAt: Date | null }) {
  const linked = await prisma.project.findFirst({ where: { driveFolderId: folder.folderId }, select: { id: true } });
  if (linked) return { projectId: linked.id, matchedBy: "linked" };

  // the estimating schedule row whose folder link is this folder
  const est = await prisma.estimateLog.findFirst({ where: { folderLink: { contains: folder.folderId } }, orderBy: { updatedAt: "desc" } });
  if (est?.projectId) {
    await prisma.project.update({ where: { id: est.projectId }, data: { driveFolderId: folder.folderId } });
    return { projectId: est.projectId, matchedBy: "estimating schedule" };
  }

  // same name, or same street address at the start of the folder name
  const n = norm(folder.name);
  const addr = folder.name.match(/^\s*(\d{2,6}(?:\s*[&/]\s*\d{2,6})?\s+[NSEW]?\.?\s*\w+)/i)?.[1];
  const candidates = await prisma.project.findMany({ where: { driveFolderId: null, OR: [{ name: folder.name.trim() }, ...(addr ? [{ address: { startsWith: addr } }, { name: { startsWith: addr } }] : [])] }, select: { id: true, name: true } });
  const same = candidates.find((c) => norm(c.name) === n) ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (same) {
    await prisma.project.update({ where: { id: same.id }, data: { driveFolderId: folder.folderId } });
    return { projectId: same.id, matchedBy: "name/address" };
  }

  // new job: status and market from the estimating schedule when it knows the job
  const residential = est ? est.market === "RESIDENTIAL" : /^\s*\d{2,6}\s/.test(folder.name) || /homes?\b|residence|lot \d/i.test(folder.name);
  const scopes = scopesFor(est?.scope ?? null);
  const job = await createProject(
    {
      name: folder.name.trim(),
      market: residential ? "RESIDENTIAL" : "COMMERCIAL",
      address: addr ? folder.name.trim() : null,
      scopes: scopes.length ? scopes : ["SIDING"],
      isPublic: false,
      isTaxExempt: false,
      bidDueDate: est?.dueAt ?? null,
      leadSource: "Moved from Drive",
    },
    IMPORTER,
  );
  const status = (est && BOARD_STATUS[est.board]) || "ESTIMATING";
  await prisma.project.update({ where: { id: job.id }, data: { driveFolderId: folder.folderId, status, statusChangedAt: folder.modifiedAt ?? new Date() } });
  if (est) await prisma.estimateLog.update({ where: { id: est.id }, data: { projectId: job.id } });
  return { projectId: job.id, matchedBy: est ? "new (from estimating schedule)" : "new" };
}

const EXPORT: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.spreadsheet": { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" },
  "application/vnd.google-apps.document": { mime: "application/pdf", ext: "pdf" },
  "application/vnd.google-apps.presentation": { mime: "application/pdf", ext: "pdf" },
  "application/vnd.google-apps.drawing": { mime: "application/pdf", ext: "pdf" },
};

/** Copies one folder's files into its job. Re-running only adds files not copied before. */
export async function importDriveFolder(id: string) {
  const row = await prisma.driveJobFolder.findUniqueOrThrow({ where: { id } });
  const token = await driveToken(null);
  const errors: string[] = [];
  let added = 0;
  let skipped = 0;
  try {
    const { projectId, matchedBy } = await jobForFolder(row);
    const files = await walk(token, row.folderId);
    for (const f of files) {
      const native = f.mimeType.startsWith("application/vnd.google-apps.");
      const exp = EXPORT[f.mimeType];
      if (native && !exp) {
        skipped++;
        continue; // forms, sites, maps: nothing to copy
      }
      if (!native && Number(f.size ?? 0) > MAX_BYTES) {
        errors.push(`${[...f.path, f.name].join(" › ")}: over 50 MB, left in Drive`);
        continue;
      }
      try {
        const dup = await prisma.document.findFirst({ where: { projectId, externalId: `drive:${f.id}` }, select: { id: true } });
        if (dup) {
          skipped++;
          continue;
        }
        const url = exp ? `${API}/${f.id}/export?mimeType=${encodeURIComponent(exp.mime)}` : `${API}/${f.id}?alt=media&supportsAllDrives=true`;
        const bytes = new Uint8Array(await (await api(token, url)).arrayBuffer());
        const name = [...f.path, exp ? `${f.name}.${exp.ext}` : f.name].join(" › ");
        await addDocument({ projectId, bytes, fileName: name, contentType: exp?.mime ?? f.mimeType, source: "DRIVE", externalId: `drive:${f.id}`, userId: null });
        added++;
      } catch (e) {
        errors.push(`${[...f.path, f.name].join(" › ")}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await prisma.driveJobFolder.update({
      where: { id },
      data: { status: errors.length && !added ? "ERROR" : "DONE", projectId, matchedBy, filesAdded: { increment: added }, filesSkipped: skipped, errors: errors.slice(0, 50), lastRunAt: new Date() },
    });
  } catch (e) {
    await prisma.driveJobFolder.update({ where: { id }, data: { status: "ERROR", errors: [e instanceof Error ? e.message : String(e)], lastRunAt: new Date() } });
  }
  return { added, skipped, errors };
}

export async function importNextBatch(n = 3) {
  const next = await prisma.driveJobFolder.findMany({ where: { status: "PENDING" }, orderBy: { modifiedAt: { sort: "desc", nulls: "last" } }, take: n });
  for (const f of next) await importDriveFolder(f.id);
  return next.length;
}

export async function driveImportSummary() {
  const [by, totals] = await Promise.all([
    prisma.driveJobFolder.groupBy({ by: ["status"], _count: true }),
    prisma.driveJobFolder.aggregate({ _sum: { fileCount: true, totalBytes: true, filesAdded: true } }),
  ]);
  const c = (s: string) => by.find((b) => b.status === s)?._count ?? 0;
  return { pending: c("PENDING"), done: c("DONE"), error: c("ERROR"), skipped: c("SKIPPED"), files: totals._sum.fileCount ?? 0, bytes: totals._sum.totalBytes ?? 0, copied: totals._sum.filesAdded ?? 0 };
}

let running = false;
let started = false;
/** While the import is switched on: a few folders every minute until none are pending; then a nightly re-scan picks up new jobs/files. */
export function startDriveImportWorker(everyMs = 60_000) {
  if (started) return;
  started = true;
  let lastScan = 0;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const s = await getSettings();
      if (!s.driveImportOn) return;
      const did = await importNextBatch(3);
      if (!did && Date.now() - lastScan > 24 * 3600_000) {
        lastScan = Date.now();
        await scanDriveJobs();
        await prisma.driveJobFolder.updateMany({ where: { status: "DONE", lastRunAt: { lt: new Date(Date.now() - 20 * 3600_000) } }, data: { status: "PENDING" } });
      }
    } catch (e) {
      console.error("[drive import]", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  }, everyMs);
}
