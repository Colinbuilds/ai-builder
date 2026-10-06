"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { saveSettings } from "@/lib/settings";

const money = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  return s === "" || !Number.isFinite(Number(s)) ? null : Number(s);
};

export async function bondingSettingsAction(f: FormData) {
  const u = await requireUser(["ADMIN", "OFFICE"]);
  const asOf = String(f.get("financialsAsOf") ?? "");
  await saveSettings(
    {
      suretyName: String(f.get("suretyName") ?? "").trim() || null,
      bondSingleLimit: money(f.get("bondSingleLimit")),
      bondAggregateLimit: money(f.get("bondAggregateLimit")),
      workingCapital: money(f.get("workingCapital")),
      netWorth: money(f.get("netWorth")),
      financialsAsOf: /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : null,
    },
    u,
  );
  revalidatePath("/reports/bonding");
}
