"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveSettings } from "@/lib/settings";
import { importDriveFolder, scanDriveJobs } from "@/lib/import/drive-jobs";
import { databasePersistence } from "@/lib/setup-check";
import { convertOldProposal, isOldProposal } from "@/lib/proposals/legacy";

export type DResult = { ok: boolean; message: string } | null;
const back = () => revalidatePath("/settings/drive-jobs");

export async function scanAction(): Promise<DResult> {
  await requireUser(["ADMIN"]);
  try {
    const r = await scanDriveJobs();
    back();
    return { ok: true, message: `Found ${r.folders} job folders in the window.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Scan failed." };
  }
}

export async function settingsAction(f: FormData) {
  const u = await requireUser(["ADMIN"]);
  const months = Number(f.get("months"));
  await saveSettings({ jobsDriveId: String(f.get("drive") ?? "").trim() || null, driveImportMonths: months > 0 && months <= 60 ? months : null }, u);
  back();
}

export async function runAction(f: FormData) {
  const u = await requireUser(["ADMIN"]);
  const on = f.get("on") === "1";
  // copying files onto the temporary disk would lose them on the next deploy
  const db = databasePersistence();
  if (on && db && !db.persistent && process.env.STORAGE_DRIVER !== "s3") return;
  await saveSettings({ driveImportOn: on || null }, u);
  back();
}

export async function retryAction(f: FormData) {
  await requireUser(["ADMIN"]);
  const id = String(f.get("id") ?? "");
  if (id) await importDriveFolder(id);
  else await prisma.driveJobFolder.updateMany({ where: { status: "ERROR" }, data: { status: "PENDING" } });
  back();
}

export async function skipAction(f: FormData) {
  await requireUser(["ADMIN"]);
  const id = String(f.get("id"));
  const row = await prisma.driveJobFolder.findUnique({ where: { id } });
  if (row) await prisma.driveJobFolder.update({ where: { id }, data: { status: row.status === "SKIPPED" ? "PENDING" : "SKIPPED" } });
  back();
}

/** Reprints moved Drive proposals of open jobs in the BTRpro layout, 25 per click (each one is a BTRbot read). */
export async function reprintAllAction(): Promise<DResult> {
  const u = await requireUser(["ADMIN"]);
  const docs = await prisma.document.findMany({
    where: { source: "DRIVE", project: { status: { notIn: ["LOST", "CLOSED", "PAID"] } } },
    select: { id: true, fileName: true, projectId: true },
    orderBy: { uploadedAt: "desc" },
  });
  const done = new Set(
    (await prisma.document.findMany({ where: { externalId: { startsWith: "converted:" } }, select: { externalId: true } })).map((d) => d.externalId!.slice("converted:".length)),
  );
  const todo = docs.filter((d) => isOldProposal(d.fileName) && !done.has(d.id));
  let ok = 0;
  const failed: string[] = [];
  for (const d of todo.slice(0, 25)) {
    try {
      await convertOldProposal(d.id, u);
      ok++;
    } catch (e) {
      failed.push(`${d.fileName}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  back();
  const left = Math.max(0, todo.length - 25);
  return { ok: !failed.length, message: `Reprinted ${ok}.${left ? ` ${left} more — press again.` : " All done."}${failed.length ? ` Problems: ${failed.slice(0, 3).join("; ")}` : ""}` };
}
