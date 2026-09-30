// Keeps BTR's price sheets current from a Google Drive folder. New or updated files in the folder are read
// with the same parser as a manual upload. A file goes live on its own only when it is clean and newer than
// the live sheet; anything doubtful is held as a draft for an Admin to review on the usual review screen.
import { prisma } from "@/lib/db";
import { getSettings, saveSettings } from "@/lib/settings";
import { accessToken } from "@/lib/integrations/oauth";
import { parseDriveLink } from "@/lib/integrations/drive";
import { applyImport, createImport } from "./imports";
import { validateRows } from "./diff";
import { UOMS, type ParsedHeader, type ParsedRow } from "./parse";
import { diffSheet } from "./diff";

const API = "https://www.googleapis.com/drive/v3/files";

/** Which BTR sheet a file is, from its name ("BTR - Steep slope (1).pdf" → SS). */
const NAME_TO_CODE: [RegExp, string, string][] = [
  [/steep/i, "SS", "BTR - Steep Slope"],
  [/mule\s*-?\s*hide/i, "MH", "BTR - Mulehide"],
  [/elevate/i, "EL", "BTR - Elevate"],
  [/statement/i, "HS", "BTR - Hardie Statement"],
  [/primed|hardie/i, "HP", "BTR - Hardie Primed"],
  [/\bndx\b|norandex|vinyl/i, "NX", "BTR - Norandex"],
  [/smart\s*side|\blp\b/i, "LP", "LP SmartSide"],
  [/central\s*states/i, "CSM", "BTR - Central States Metal"],
];
export function sheetForFileName(name: string): { code: string; name: string } | null {
  const hit = NAME_TO_CODE.find(([re]) => re.test(name));
  return hit ? { code: hit[1], name: hit[2] } : null;
}
const SHEET_FILE = /\.(pdf|csv|txt|zip)$/i;

// Hold for review when this much of the sheet looks off.
const MAX_UNPARSED_SHARE = 0.05;
const MAX_REMOVED_SHARE = 0.2;
const BIG_MOVE_PCT = 25;
const MAX_BIG_MOVES_SHARE = 0.1;

export type SyncResult = { checked: number; applied: string[]; held: string[]; skipped: number; unmatched: string[]; errors: string[] };

type DriveFile = { id: string; name: string; mimeType: string; modifiedTime: string };

async function driveGet(token: string, url: string) {
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (r.status === 404) throw new Error("Drive says the folder doesn't exist or isn't shared with the connected account.");
  if (!r.ok) throw new Error(`Google Drive error (${r.status}).`);
  return r;
}

/** Decides what to do with a parsed sheet: apply, hold (with reasons), or skip as not newer. */
export function judgeSheet(
  parsed: { header: ParsedHeader; rows: ParsedRow[]; unparsed: unknown[] },
  live: { effectiveDate: Date | null; items: { itemNumber: string; description: string; unitPrice: number | null; priceStatus: "LISTED" | "CALL"; uom: string }[] } | null,
): { action: "APPLY" | "HOLD" | "SKIP"; reasons: string[] } {
  const reasons: string[] = [];
  const eff = parsed.header.effective;
  if (!eff) reasons.push("no effective date found on the sheet");
  if (!parsed.header.expiration) reasons.push("no expiration date found on the sheet");
  if (live?.effectiveDate && eff && new Date(`${eff}T00:00:00Z`) <= live.effectiveDate)
    return { action: "SKIP", reasons: [`not newer than the live sheet (effective ${eff})`] };
  if (!parsed.rows.length) reasons.push("no item rows could be read");
  const problems = validateRows(parsed.rows.map((r) => ({ ...r, itemNumber: r.itemNumber.trim().toUpperCase(), uom: r.uom.trim().toUpperCase() })), UOMS);
  if (problems.length) reasons.push(`${problems.length} row problem(s), e.g. ${problems[0]}`);
  if (parsed.rows.length && parsed.unparsed.length / (parsed.rows.length + parsed.unparsed.length) > MAX_UNPARSED_SHARE)
    reasons.push(`${parsed.unparsed.length} line(s) couldn't be read as items`);
  if (live?.items.length && parsed.rows.length) {
    const d = diffSheet(live.items, parsed.rows);
    if (d.removed.length / live.items.length > MAX_REMOVED_SHARE) reasons.push(`${d.removed.length} of ${live.items.length} live items are missing from the new sheet`);
    const big = d.changed.filter((c) => c.pctChange != null && Math.abs(c.pctChange) > BIG_MOVE_PCT);
    if (big.length / parsed.rows.length > MAX_BIG_MOVES_SHARE) reasons.push(`${big.length} prices moved more than ${BIG_MOVE_PCT}%`);
  }
  return { action: reasons.length ? "HOLD" : "APPLY", reasons };
}

export async function syncPriceSheets(): Promise<SyncResult> {
  const s = await getSettings();
  const result: SyncResult = { checked: 0, applied: [], held: [], skipped: 0, unmatched: [], errors: [] };
  if (!s.priceSheetFolder || !s.priceSheetSyncUserId) throw new Error("Set the price-sheet folder first (Price sheets page).");
  const folderId = parseDriveLink(s.priceSheetFolder);
  if (!folderId) throw new Error("The saved price-sheet folder link isn't a Drive folder link.");
  const { token } = await accessToken("GOOGLE_DRIVE", s.priceSheetSyncUserId);
  const files: DriveFile[] = [];
  let pageToken = "";
  do {
    const q = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime)",
      pageSize: "200",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      orderBy: "modifiedTime",
      ...(pageToken ? { pageToken } : {}),
    });
    const j = await (await driveGet(token, `${API}?${q}`)).json();
    files.push(...(j.files as DriveFile[]));
    pageToken = j.nextPageToken ?? "";
  } while (pageToken);

  for (const f of files.filter((x) => SHEET_FILE.test(x.name))) {
    if (await prisma.driveSheetFile.findFirst({ where: { driveFileId: f.id, modifiedTime: f.modifiedTime } })) continue;
    result.checked++;
    const record = (status: string, extra: { code?: string | null; importId?: string | null; message?: string | null } = {}) =>
      prisma.driveSheetFile.create({ data: { driveFileId: f.id, name: f.name, modifiedTime: f.modifiedTime, status, ...extra } });
    const sheet = sheetForFileName(f.name);
    if (!sheet) {
      result.unmatched.push(f.name);
      await record("UNMATCHED", { message: "The file name doesn't say which sheet it is. Upload it by hand and pick the sheet, or rename it (e.g. \"BTR - Steep Slope\")." });
      continue;
    }
    try {
      const bytes = new Uint8Array(await (await driveGet(token, `${API}/${f.id}?alt=media&supportsAllDrives=true`)).arrayBuffer());
      const live = await prisma.priceSheet.findFirst({ where: { code: sheet.code, isActive: true, companyId: null }, include: { items: true } });
      const imp = await createImport({ bytes, fileName: f.name, code: sheet.code, name: live?.name ?? sheet.name, scope: live?.scope ?? null, userId: s.priceSheetSyncUserId });
      const parsed = { header: imp.header as ParsedHeader, rows: imp.rows as ParsedRow[], unparsed: imp.unparsed as unknown[] };
      const verdict = judgeSheet(parsed, live && live.isLoaded ? { effectiveDate: live.effectiveDate, items: live.items } : null);
      if (verdict.action === "SKIP") {
        await prisma.sheetImport.update({ where: { id: imp.id }, data: { status: "DISCARDED" } });
        result.skipped++;
        await record("SKIPPED_OLDER", { code: sheet.code, message: verdict.reasons[0] });
      } else if (verdict.action === "HOLD") {
        result.held.push(f.name);
        await record("DRAFT", { code: sheet.code, importId: imp.id, message: `Held for review: ${verdict.reasons.join("; ")}.` });
      } else {
        const { summary } = await applyImport(imp.id, { name: live?.name ?? sheet.name, scope: live?.scope ?? null, header: parsed.header, rows: parsed.rows }, s.priceSheetSyncUserId);
        result.applied.push(`${sheet.code} (${f.name})`);
        await record("APPLIED", { code: sheet.code, importId: imp.id, message: `Live: ${summary.items} items, ${summary.changed} changed, ${summary.added} added, ${summary.removed} removed. Effective ${parsed.header.effective}.` });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`${f.name}: ${msg}`);
      await record("ERROR", { code: sheet.code, message: msg });
    }
  }
  await saveSettings({ priceSheetLastCheck: new Date().toISOString() }, { id: s.priceSheetSyncUserId, name: "Price sheet sync" });
  return result;
}

let started = false;
/** Checks the folder shortly after start, then every 6 hours. No-op until a folder is set. */
export function startSheetWatcher(everyMs = 6 * 3600_000) {
  if (started) return;
  started = true;
  const run = async () => {
    try {
      const s = await getSettings();
      if (!s.priceSheetFolder || !s.priceSheetSyncUserId) return;
      const r = await syncPriceSheets();
      if (r.checked) console.log(`[price sheets] checked ${r.checked}: applied ${r.applied.length}, held ${r.held.length}, unmatched ${r.unmatched.length}, errors ${r.errors.length}`);
    } catch (e) {
      console.error("[price sheets] sync failed:", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(run, 60_000);
  setInterval(run, everyMs);
}
