"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveSettings } from "@/lib/settings";
import { addCashItem } from "@/lib/reports/cash";

const money = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  return s === "" || !Number.isFinite(Number(s)) ? null : Number(s);
};

export async function cashSettingsAction(f: FormData) {
  const u = await requireUser(["ADMIN", "OFFICE"]);
  const bal = money(f.get("cashOnHand"));
  await saveSettings(
    { cashOnHand: bal, cashAsOf: bal == null ? null : new Date().toISOString().slice(0, 10), weeklyPayroll: money(f.get("weeklyPayroll")), monthlyOverhead: money(f.get("monthlyOverhead")), cashFloor: money(f.get("cashFloor")) },
    u,
  );
  revalidatePath("/reports/cash");
}

export async function cashItemAction(f: FormData) {
  const u = await requireUser(["ADMIN", "OFFICE"]);
  const amt = money(f.get("amount"));
  const date = String(f.get("date") ?? "");
  if (amt == null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  await addCashItem({ date: new Date(`${date}T12:00:00Z`), label: String(f.get("label") ?? ""), amount: f.get("dir") === "out" ? -Math.abs(amt) : Math.abs(amt) }, u);
  revalidatePath("/reports/cash");
}

export async function deleteCashItemAction(f: FormData) {
  await requireUser(["ADMIN", "OFFICE"]);
  await prisma.cashItem.delete({ where: { id: String(f.get("id")) } });
  revalidatePath("/reports/cash");
}
