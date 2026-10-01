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
  return new SignJWT({ role: p.role, name: p.name, typ: "staff" })
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
    // a crew-portal token never counts as a staff session
    if (payload.typ === "crew") return null;
    return { sub: payload.sub as string, role: payload.role as Role, name: payload.name as string };
  } catch {
    return null;
  }
}

// Crew portal: its own cookie and token type. A crew can only send invoices and job photos.
export const CREW_COOKIE = "btr_crew";
export const CREW_MAX_AGE = 60 * 60 * 24 * 30; // 30 days on the crew's phone

export async function signCrewSession(crewId: string) {
  return new SignJWT({ typ: "crew" }).setProtectedHeader({ alg: "HS256" }).setSubject(crewId).setIssuedAt().setExpirationTime(`${CREW_MAX_AGE}s`).sign(secret());
}

export async function verifyCrewSession(token: string | undefined): Promise<{ crewId: string; iat: number } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.typ !== "crew" || !payload.sub) return null;
    return { crewId: payload.sub, iat: payload.iat ?? 0 };
  } catch {
    return null;
  }
}
