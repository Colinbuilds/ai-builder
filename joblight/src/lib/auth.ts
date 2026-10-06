import "server-only";
import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySession } from "./session";

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Checks the operator login from env. Both must be set; the password needs 12+ characters. */
export function checkLogin(email: string, password: string): boolean {
  const e = process.env.CONSOLE_EMAIL?.trim().toLowerCase();
  const p = process.env.CONSOLE_PASSWORD ?? "";
  if (!e || p.length < 12) return false;
  return same(email.trim().toLowerCase(), e) && same(password, p);
}

export async function requireOperator() {
  const s = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) redirect("/console/login");
  return s;
}
