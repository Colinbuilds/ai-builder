"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { saveSettings } from "@/lib/settings";
import { addBidToSchedule, addSource, checkAll, checkSource, decideBid } from "@/lib/bids/service";

const again = () => revalidatePath("/bids");

export async function decideAction(f: FormData) {
  const u = await requireUser(STAFF_ROLES);
  const s = String(f.get("status"));
  await decideBid(String(f.get("id")), s === "WATCH" ? "WATCH" : s === "NEW" ? "NEW" : "PASS", u);
  again();
}

export async function scheduleAction(f: FormData) {
  const u = await requireUser(STAFF_ROLES);
  await addBidToSchedule(String(f.get("id")), u);
  again();
  revalidatePath("/estimating/schedule");
}

export async function checkNowAction() {
  await requireUser(STAFF_ROLES);
  await checkAll();
  again();
}

export async function checkOneAction(f: FormData) {
  await requireUser(STAFF_ROLES);
  await checkSource(String(f.get("id")));
  again();
}

export async function toggleSourceAction(f: FormData) {
  await requireUser(["ADMIN", "OFFICE", "ESTIMATOR"]);
  await prisma.bidSource.update({ where: { id: String(f.get("id")) }, data: { enabled: f.get("on") === "1" } });
  again();
}

export async function deleteSourceAction(f: FormData) {
  await requireUser(["ADMIN"]);
  await prisma.bidSource.delete({ where: { id: String(f.get("id")) } });
  again();
}

export async function addSourceAction(f: FormData) {
  const u = await requireUser(["ADMIN", "OFFICE", "ESTIMATOR"]);
  let err = "";
  try {
    const s = await addSource({ name: String(f.get("name") ?? ""), kind: String(f.get("kind") ?? ""), url: String(f.get("url") ?? ""), defaultCity: String(f.get("defaultCity") ?? "") || null, defaultState: String(f.get("defaultState") ?? "") || null }, u);
    await checkSource(s.id);
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  again();
  redirect(`/bids?v=sources${err ? `&err=${encodeURIComponent(err)}` : ""}#sources`);
}

export async function radiusAction(f: FormData) {
  const u = await requireUser(["ADMIN", "OFFICE", "ESTIMATOR"]);
  const n = Number(f.get("miles"));
  await saveSettings({ bidRadiusMiles: Number.isFinite(n) && n >= 10 && n <= 400 ? Math.round(n) : null }, u);
  again();
}
