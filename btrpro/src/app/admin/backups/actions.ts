"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { backupNow } from "@/lib/backup";

export async function backupNowAction() {
  await requireUser(["ADMIN"]);
  let msg: string;
  try {
    const r = await backupNow();
    msg = `Saved ${r.file.name}${r.offsite === "sent" ? " and copied off-site" : r.offsite === "not set up" ? "" : ` (off-site copy ${r.offsite})`}.`;
  } catch (e) {
    msg = `Backup failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  redirect(`/admin/backups?msg=${encodeURIComponent(msg)}`);
}
