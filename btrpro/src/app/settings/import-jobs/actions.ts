"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  fetchScheduleFromDrive,
  guessMarket,
  importSchedule,
  storeUploadedSchedule,
  type Market,
} from "@/lib/import/service";

export type LoadResult = { problems: string[] } | null;
export type ImportResult = {
  problems: string[];
  ok?: boolean;
  note?: string;
  errors?: string[];
} | null;

export async function loadScheduleAction(
  _: LoadResult,
  f: FormData,
): Promise<LoadResult> {
  const user = await requireUser(["ADMIN"]);
  let file: { fileUrl: string; fileName: string };
  try {
    const up = f.get("file");
    if (up instanceof File && up.size > 0)
      file = await storeUploadedSchedule(
        new Uint8Array(await up.arrayBuffer()),
        up.name,
      );
    else {
      const link = String(f.get("link") ?? "").trim();
      if (!link)
        return {
          problems: [
            "Paste the schedule's Google Sheets link or choose a file.",
          ],
        };
      file = await fetchScheduleFromDrive(link, user.id);
    }
  } catch (e) {
    return { problems: [e instanceof Error ? e.message : String(e)] };
  }
  const m = String(f.get("market") ?? "AUTO");
  const market: Market =
    m === "RESIDENTIAL" || m === "COMMERCIAL" ? m : guessMarket(file.fileName);
  redirect(
    `/settings/import-jobs?${new URLSearchParams({ f: file.fileUrl, n: file.fileName, m: market })}`,
  );
}

export async function runImportAction(
  _: ImportResult,
  f: FormData,
): Promise<ImportResult> {
  const user = await requireUser(["ADMIN"]);
  const fileUrl = String(f.get("fileUrl"));
  if (!fileUrl.includes("imports/schedules"))
    return { problems: ["Load the schedule again."] };
  const mapping: Record<string, string> = {};
  for (const [k, v] of f.entries())
    if (k.startsWith("map:")) mapping[k.slice(4)] = String(v);
  try {
    const r = await importSchedule(
      {
        fileUrl,
        fileName: String(f.get("fileName")),
        market: String(f.get("market")) as Market,
        mapping,
        source: String(f.get("fileName")).replace(/\.(xlsx|csv)$/i, ""),
      },
      user,
    );
    revalidatePath("/");
    return {
      problems: [],
      ok: true,
      note: `${r.created} jobs created, ${r.updated} updated, ${r.unchanged} already up to date, ${r.skipped} skipped${r.accountsCreated ? `, ${r.accountsCreated} new accounts` : ""}.`,
      errors: r.errors.slice(0, 20),
    };
  } catch (e) {
    return { problems: [e instanceof Error ? e.message : String(e)] };
  }
}
