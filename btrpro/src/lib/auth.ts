import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, verifySession, type Role } from "@/lib/session";

// Re-reads the user from the DB so role changes and deletions take effect immediately.
export async function getCurrentUser() {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  return prisma.user.findUnique({
    where: { id: session.sub },
    select: { id: true, name: true, email: true, role: true },
  });
}

export async function requireUser(roles?: Role[]) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.role)) redirect("/?denied=1");
  return user;
}
