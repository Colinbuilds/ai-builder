"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { saveSettings } from "@/lib/settings";
import {
  AX_FIELD_KEYS,
  importAccuLynx,
  storeAccuLynxExport,
  type AxField,
} from "@/lib/import/acculynx";
import type { Stage } from "@/lib/import/schedule";

export type AxResult = {
  problems: string[];
  ok?: boolean;
  note?: string;
  errors?: string[];
} | null;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function loadAccuLynxAction(
  _: AxResult,
  f: FormData,
): Promise<AxResult> {
  await requireUser(["ADMIN"]);
  const file = f.get("file");
  if (!(file instanceof File) || !file.size)
    return { problems: ["Choose the AccuLynx export (.csv or .xlsx)."] };
  let stored: { fileUrl: string; fileName: string };
  try {
    stored = await storeAccuLynxExport(
      new Uint8Array(await file.arrayBuffer()),
      file.name,
    );
  } catch (e) {
    return { problems: [msg(e)] };
  }
  redirect(
    `/settings/acculynx?${new URLSearchParams({ f: stored.fileUrl, n: stored.fileName })}`,
  );
}

export async function importAccuLynxAction(
  _: AxResult,
  f: FormData,
): Promise<AxResult> {
  const u = await requireUser(["ADMIN"]);
  const fileUrl = String(f.get("fileUrl"));
  if (!fileUrl.includes("imports/acculynx"))
    return { problems: ["Upload the export again."] };
  const map: Partial<Record<AxField, number>> = {};
  for (const k of AX_FIELD_KEYS) {
    const v = String(f.get(`col:${k}`) ?? "");
    if (v !== "") map[k] = Number(v);
  }
  if (map.jobName == null && map.street == null && map.jobNumber == null)
    return {
      problems: ["Match at least the job name, number, or street column."],
    };
  const stages: Record<string, Stage | "SKIP"> = {};
  for (const [k, v] of f.entries())
    if (k.startsWith("stage:"))
      stages[k.slice(6)] = String(v) as Stage | "SKIP";
  try {
    const r = await importAccuLynx(
      {
        fileUrl,
        fileName: String(f.get("fileName")),
        map,
        stages,
        market: f.get("market") === "COMMERCIAL" ? "COMMERCIAL" : "RESIDENTIAL",
      },
      u,
    );
    revalidatePath("/");
    revalidatePath("/settings/acculynx");
    return {
      problems: [],
      ok: true,
      note: `${r.created} jobs created, ${r.linked} linked to jobs already here, ${r.updated} updated, ${r.unchanged} already up to date, ${r.skipped} skipped${r.accountsCreated ? `, ${r.accountsCreated} new accounts` : ""}.`,
      errors: r.errors.slice(0, 20),
    };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}

export async function saveCutoverAction(
  _: AxResult,
  f: FormData,
): Promise<AxResult> {
  const u = await requireUser(["ADMIN"]);
  const d = String(f.get("date") ?? "").trim();
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d))
    return { problems: ["Pick a date."] };
  await saveSettings({ acculynxCutoverDate: d || null }, u);
  revalidatePath("/settings/acculynx");
  return {
    problems: [],
    ok: true,
    note: d ? `Cutover set for ${d}.` : "Cutover date cleared.",
  };
}
