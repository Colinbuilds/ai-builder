// Session cookie helpers. Edge-safe (used by middleware), so no Prisma here.
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "ep_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 14; // 14 days

export type Role = "ADMIN" | "ESTIMATOR" | "VIEWER";
export type SessionPayload = { sub: string; role: Role; name: string };

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(s);
}

export async function signSession(p: SessionPayload) {
  return new SignJWT({ role: p.role, name: p.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(p.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return { sub: payload.sub as string, role: payload.role as Role, name: payload.name as string };
  } catch {
    return null;
  }
}
