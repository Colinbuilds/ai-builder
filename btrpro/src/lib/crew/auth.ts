import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { CREW_COOKIE, verifyCrewSession } from "@/lib/session";

export { CrewAuthError, checkCrewLogin, setCrewLogin } from "./login";

/** The signed-in crew (portal login), or null. Logins the office turned off or reset end older sessions. */
export async function getCurrentCrew() {
  const s = await verifyCrewSession((await cookies()).get(CREW_COOKIE)?.value);
  if (!s) return null;
  const crew = await prisma.crew.findUnique({ where: { id: s.crewId }, select: { id: true, name: true, kind: true, active: true, passwordHash: true, loginChangedAt: true, leadName: true } });
  if (!crew || !crew.active || !crew.passwordHash) return null;
  if (crew.loginChangedAt && crew.loginChangedAt.getTime() > s.iat * 1000 + 999) return null;
  return { id: crew.id, name: crew.name, kind: crew.kind, leadName: crew.leadName };
}

export async function requireCrew() {
  const c = await getCurrentCrew();
  if (!c) redirect("/crew/login");
  return c;
}

