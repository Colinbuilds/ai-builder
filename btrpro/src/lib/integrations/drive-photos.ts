// Job photos from Google Drive. CompanyCam syncs every project into BTR Contracting/CompanyCam as one folder
// named "<project> - <address>", with the photos inside named project_<ccId>_<MMDDYYYY>_<HHMM>.jpg.
// A job is linked to its folder (matched by street address, or picked by hand) and the photos are shown
// through BTRpro to signed-in staff — nothing is copied out of Drive.
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { parseDriveLink } from "./drive";
import { driveNotFound, driveToken } from "./google-sa";

const API = "https://www.googleapis.com/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";
export const COMPANYCAM_DRIVE_DEFAULT = "https://drive.google.com/drive/folders/1-uX1JlRYqu7rzWXnAdqkltMeppu8CsXL";

export type PhotoFolder = { id: string; name: string };
export type DrivePhoto = { id: string; name: string; takenAt: Date | null; thumb: string; full: string; view: string };

async function get(token: string, url: string) {
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (r.status === 404) throw new Error(driveNotFound());
  if (!r.ok) throw new Error(`Google Drive error (${r.status}).`);
  return r;
}

/** "Greg Coleman  - 19356 Little Prairie Ln Springfield NE" → house number + first street word: "19356 little". */
export function streetKey(s: string | null | undefined): string | null {
  const m = (s ?? "").toLowerCase().match(/\b(\d{2,6})\s+(?:[nsew]\.?\s+)?([a-z][a-z0-9]*)/);
  return m ? `${m[1]} ${m[2]}` : null;
}
const folderAddress = (name: string) => {
  const parts = name.split(/\s+-\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : name;
};

/** Photo time from CompanyCam's file name: project_110175309_07192026_1559.jpg → 2026-07-19 15:59 (local). */
export function photoTime(fileName: string): Date | null {
  const m = fileName.match(/_(\d{2})(\d{2})(\d{4})_(\d{2})(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]), Number(m[4]), Number(m[5]));
  return Number.isNaN(d.getTime()) ? null : d;
}
export const companyCamIdFromFile = (fileName: string) => fileName.match(/^project_(\d+)_/)?.[1] ?? null;

/** The folder a job belongs to: same street address (unique), else the CompanyCam project id, else none. */
export function matchPhotoFolder(job: { address: string | null; name: string }, folders: PhotoFolder[]): PhotoFolder | null {
  const key = streetKey(job.address) ?? streetKey(job.name);
  if (!key) return null;
  const hits = folders.filter((f) => streetKey(folderAddress(f.name)) === key);
  return hits.length === 1 ? hits[0] : null;
}

let cache: { at: number; root: string; folders: PhotoFolder[] } | null = null;

/** CompanyCam's project folders in Drive (cached for 10 minutes). */
export async function photoFolders(userId: string | null): Promise<PhotoFolder[]> {
  const s = await getSettings();
  const root = parseDriveLink(s.companyCamDriveFolder ?? COMPANYCAM_DRIVE_DEFAULT);
  if (!root) return [];
  if (cache && cache.root === root && Date.now() - cache.at < 600_000) return cache.folders;
  const token = await driveToken(userId);
  const folders: PhotoFolder[] = [];
  let pageToken = "";
  do {
    const q = new URLSearchParams({
      q: `'${root}' in parents and mimeType = '${FOLDER}' and trashed = false`,
      fields: "nextPageToken,files(id,name)",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      ...(pageToken ? { pageToken } : {}),
    });
    const j = (await (await get(token, `${API}?${q}`)).json()) as { files: PhotoFolder[]; nextPageToken?: string };
    folders.push(...j.files);
    pageToken = j.nextPageToken ?? "";
  } while (pageToken);
  folders.sort((a, b) => a.name.localeCompare(b.name));
  cache = { at: Date.now(), root, folders };
  return folders;
}

/** Photos in a job's folder, newest first. */
export async function jobPhotos(folderId: string, userId: string | null, pageToken?: string | null) {
  const token = await driveToken(userId);
  const q = new URLSearchParams({
    q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
    fields: "nextPageToken,files(id,name,createdTime,imageMediaMetadata(time))",
    orderBy: "createdTime desc",
    pageSize: "60",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
    ...(pageToken ? { pageToken } : {}),
  });
  const j = (await (await get(token, `${API}?${q}`)).json()) as { files: { id: string; name: string; createdTime: string }[]; nextPageToken?: string };
  const photos: DrivePhoto[] = j.files.map((f) => ({
    id: f.id,
    name: f.name,
    takenAt: photoTime(f.name) ?? new Date(f.createdTime),
    thumb: `/api/drive/photo/${f.id}?s=400`,
    full: `/api/drive/photo/${f.id}`,
    view: `https://drive.google.com/file/d/${f.id}/view`,
  }));
  return { photos, next: j.nextPageToken ?? null };
}

/** Links a job to its photo folder, found by address when no folder is given. */
export async function linkPhotoFolder(projectId: string, folderId: string | null, actor: { id: string; name: string }) {
  let id = folderId;
  if (id === undefined || id === "AUTO") {
    const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { address: true, name: true } });
    id = matchPhotoFolder(p, await photoFolders(actor.id))?.id ?? null;
    if (!id) throw new Error("No CompanyCam folder in Drive matches this job's address. Pick it from the list.");
  }
  await prisma.project.update({ where: { id: projectId }, data: { photoFolderId: id } });
  await prisma.projectActivity.create({ data: { projectId, userId: actor.id, kind: "details", text: id ? `${actor.name} linked the job's photo folder in Drive` : `${actor.name} unlinked the photo folder` } });
  return id;
}

/** Streams a photo (or its thumbnail) if it lives in a folder linked to a job. */
export async function photoBytes(fileId: string, size: number | null, userId: string) {
  if (!/^[\w-]{10,}$/.test(fileId)) return null;
  const token = await driveToken(userId);
  const meta = (await (await get(token, `${API}/${fileId}?fields=mimeType,parents,thumbnailLink&supportsAllDrives=true`)).json()) as {
    mimeType: string;
    parents?: string[];
    thumbnailLink?: string;
  };
  if (!meta.mimeType.startsWith("image/") || !meta.parents?.length) return null;
  if (!(await prisma.project.findFirst({ where: { photoFolderId: { in: meta.parents } }, select: { id: true } }))) return null;
  if (size && meta.thumbnailLink) {
    const r = await fetch(meta.thumbnailLink.replace(/=s\d+$/, `=s${size}`), { headers: { authorization: `Bearer ${token}` } });
    if (r.ok) return { bytes: new Uint8Array(await r.arrayBuffer()), type: r.headers.get("content-type") ?? "image/jpeg" };
  }
  const r = await get(token, `${API}/${fileId}?alt=media&supportsAllDrives=true`);
  return { bytes: new Uint8Array(await r.arrayBuffer()), type: meta.mimeType };
}
