// Crew portal logins: checking a sign-in and the office setting/resetting/turning off a crew's login.
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

export class CrewAuthError extends Error {}
const normEmail = (e: string) => e.trim().toLowerCase();

export async function checkCrewLogin(email: string, password: string) {
  const crews = await prisma.crew.findMany({ where: { loginEmail: normEmail(email), active: true, passwordHash: { not: null } }, omit: { passwordHash: false } });
  // one login email belongs to one crew; refuse to guess if data were ever duplicated
  if (crews.length !== 1) return null;
  const c = crews[0];
  if (!(await bcrypt.compare(password, c.passwordHash!))) return null;
  await prisma.crew.update({ where: { id: c.id }, data: { lastLoginAt: new Date() } });
  return c;
}

/** Office side: give a crew a portal login, change its password, or turn it off (password null). */
export async function setCrewLogin(crewId: string, input: { email: string; password: string | null }, actor: { id: string; name: string; role: string }) {
  if (actor.role !== "ADMIN") throw new CrewAuthError("Only an Admin sets crew logins.");
  const crew = await prisma.crew.findUniqueOrThrow({ where: { id: crewId } });
  if (input.password === null) {
    await prisma.crew.update({ where: { id: crewId }, data: { passwordHash: null, loginChangedAt: new Date() } });
    await prisma.auditLog.create({ data: { userId: actor.id, entity: "Crew", entityId: crewId, action: "crew-login-off", before: { email: crew.loginEmail }, after: {} } });
    return;
  }
  const email = normEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new CrewAuthError("Enter the crew's email address for their login.");
  if (input.password.length < 8) throw new CrewAuthError("Use a password of at least 8 characters.");
  const taken = await prisma.crew.findFirst({ where: { loginEmail: email, id: { not: crewId } } });
  if (taken) throw new CrewAuthError(`${email} is already the login for ${taken.name}.`);
  if (await prisma.user.findUnique({ where: { email } })) throw new CrewAuthError("That email is a staff login. Use a different email for the crew.");
  await prisma.crew.update({ where: { id: crewId }, data: { loginEmail: email, passwordHash: await bcrypt.hash(input.password, 10), loginChangedAt: new Date() } });
  await prisma.auditLog.create({ data: { userId: actor.id, entity: "Crew", entityId: crewId, action: "crew-login-set", before: { email: crew.loginEmail }, after: { email } } });
}
