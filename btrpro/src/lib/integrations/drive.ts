// Import plans, specs, reports, and photos from a Google Drive file or folder link into a job.
import { addDocument } from "@/lib/docs/documents";
import { driveNotFound, driveToken } from "./google-sa";

const API = "https://www.googleapis.com/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";

/** Accepts a Drive/Docs share link or a bare file id. */
export function parseDriveLink(link: string): string | null {
  const s = link.trim();
  const m =
    s.match(/\/(?:file|document|spreadsheets|presentation|drawings)\/d\/([\w-]{10,})/) ??
    s.match(/\/folders\/([\w-]{10,})/) ??
    s.match(/[?&]id=([\w-]{10,})/);
  if (m) return m[1];
  return /^[\w-]{20,}$/.test(s) ? s : null;
}

type DriveFile = { id: string; name: string; mimeType: string; size?: string };

export async function importFromDrive(projectId: string, link: string, user: { id: string }) {
  const id = parseDriveLink(link);
  if (!id) throw new Error("That doesn't look like a Google Drive file or folder link.");
  const token = await driveToken(user.id);
  const auth = { authorization: `Bearer ${token}` };
  const get = async (url: string) => {
    const r = await fetch(url, { headers: auth });
    if (r.status === 404) throw new Error(driveNotFound());
    if (!r.ok) throw new Error(`Google Drive error (${r.status}).`);
    return r;
  };
  const meta: DriveFile = await (await get(`${API}/${id}?fields=id,name,mimeType,size&supportsAllDrives=true`)).json();
  let files: DriveFile[] = [meta];
  if (meta.mimeType === FOLDER) {
    files = [];
    let pageToken = "";
    do {
      const q = new URLSearchParams({
        q: `'${id}' in parents and trashed = false`,
        fields: "nextPageToken,files(id,name,mimeType,size)",
        pageSize: "200",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
        ...(pageToken ? { pageToken } : {}),
      });
      const j = await (await get(`${API}?${q}`)).json();
      files.push(...(j.files as DriveFile[]).filter((f) => f.mimeType !== FOLDER));
      pageToken = j.nextPageToken ?? "";
    } while (pageToken);
  }
  const result = { added: 0, skipped: 0, errors: [] as string[] };
  for (const f of files) {
    try {
      const native = f.mimeType.startsWith("application/vnd.google-apps.");
      const url = native ? `${API}/${f.id}/export?mimeType=application/pdf` : `${API}/${f.id}?alt=media&supportsAllDrives=true`;
      const bytes = new Uint8Array(await (await get(url)).arrayBuffer());
      const { duplicate } = await addDocument({
        projectId,
        bytes,
        fileName: native ? `${f.name}.pdf` : f.name,
        contentType: native ? "application/pdf" : f.mimeType,
        source: "DRIVE",
        externalId: `drive:${f.id}`,
        userId: user.id,
      });
      if (duplicate) result.skipped++;
      else result.added++;
    } catch (e) {
      result.errors.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return result;
}
