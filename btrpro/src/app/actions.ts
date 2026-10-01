"use server";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, type Role } from "@/lib/session";
import { ROLES } from "@/lib/roles";

export type LoginState = { error: string; email: string } | null;

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return { error: "Email or password is incorrect.", email };
  const token = await signSession({ sub: user.id, role: user.role, name: user.name });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}


export async function createUser(_prev: string | null, form: FormData): Promise<string | null> {
  const admin = await requireUser(["ADMIN"]);
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const role = String(form.get("role")) as Role;
  if (!name || !email) return "Name and email are required.";
  if (password.length < 10) return "Password must be at least 10 characters.";
  if (!ROLES.includes(role)) return "Pick a role.";
  if (await prisma.user.findUnique({ where: { email } })) return "A user with that email already exists.";
  const user = await prisma.user.create({
    data: { name, email, role, passwordHash: await bcrypt.hash(password, 10) },
  });
  await prisma.auditLog.create({
    data: { userId: admin.id, entity: "User", entityId: user.id, action: "create", after: { name, email, role } },
  });
  revalidatePath("/admin/users");
  return null;
}

export async function setUserRole(form: FormData) {
  const admin = await requireUser(["ADMIN"]);
  const id = String(form.get("id"));
  const role = String(form.get("role")) as Role;
  if (!ROLES.includes(role) || id === admin.id) return; // admins can't demote themselves
  const before = await prisma.user.update({ where: { id }, data: { role }, select: { role: true } });
  await prisma.auditLog.create({
    data: { userId: admin.id, entity: "User", entityId: id, action: "set_role", before, after: { role } },
  });
  revalidatePath("/admin/users");
}

/** Owners get the Audit tools. Only an owner can grant it — or any admin while nobody holds it yet. */
export async function setUserOwner(form: FormData) {
  const me = await requireUser(["ADMIN"]);
  const owners = await prisma.user.count({ where: { isOwner: true } });
  if (owners > 0 && !me.isOwner) return;
  const id = String(form.get("id"));
  const isOwner = form.get("isOwner") === "on";
  if (id === me.id && !isOwner) return; // an owner can't remove themselves
  await prisma.user.update({ where: { id }, data: { isOwner } });
  await prisma.auditLog.create({ data: { userId: me.id, entity: "User", entityId: id, action: "set_owner", after: { isOwner } } });
  revalidatePath("/admin/users");
}


/** The phone number printed on proposals when this person is the company representative. */
export async function setUserPhone(form: FormData) {
  const me = await requireUser(["ADMIN"]);
  const id = String(form.get("id"));
  const phone = String(form.get("phone") ?? "").trim() || null;
  await prisma.user.update({ where: { id }, data: { phone } });
  await prisma.auditLog.create({ data: { userId: me.id, entity: "User", entityId: id, action: "set_phone", after: { phone } } });
  revalidatePath("/admin/users");
}
