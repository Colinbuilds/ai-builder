"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { checkLogin, requireOperator } from "@/lib/auth";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/session";
import { BuildoutError, createBuildout, runChecks, updateBuildout } from "@/lib/buildouts";
import { prisma } from "@/lib/db";

export type ConsoleState = { error?: string; ok?: boolean } | null;

export async function login(_: ConsoleState, f: FormData): Promise<ConsoleState> {
  const email = String(f.get("email") ?? "");
  if (!checkLogin(email, String(f.get("password") ?? ""))) return { error: "Wrong email or password (or CONSOLE_EMAIL / CONSOLE_PASSWORD isn't set)." };
  (await cookies()).set(SESSION_COOKIE, await signSession(email.trim().toLowerCase()), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: SESSION_MAX_AGE, path: "/" });
  redirect("/console");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/console/login");
}

const form = (f: FormData) => Object.fromEntries([...f.entries()].filter(([, v]) => typeof v === "string"));

export async function saveBuildout(_: ConsoleState, f: FormData): Promise<ConsoleState> {
  await requireOperator();
  const id = String(f.get("id") ?? "");
  let target = "/console";
  try {
    if (id) await updateBuildout(id, form(f));
    else target = `/console/buildouts/${(await createBuildout(form(f))).id}`;
  } catch (e) {
    if (e instanceof BuildoutError) return { error: e.message };
    throw e;
  }
  revalidatePath("/console", "layout");
  if (id) return { ok: true };
  redirect(target);
}

export async function checkNow(f: FormData) {
  await requireOperator();
  const id = String(f.get("id") ?? "");
  await runChecks(id ? [id] : undefined);
  revalidatePath("/console", "layout");
}

export async function setLeadStatus(f: FormData) {
  await requireOperator();
  const status = String(f.get("status"));
  if (!["NEW", "CONTACTED", "DEMO_BOOKED", "WON", "LOST"].includes(status)) return;
  await prisma.lead.update({ where: { id: String(f.get("id")) }, data: { status: status as never, notes: String(f.get("notes") ?? "").trim() || null } });
  revalidatePath("/console", "layout");
}
