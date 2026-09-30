import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notificationFeed } from "@/lib/notifications";

/** The notifications panel's contents for the signed-in user. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const [notes, me] = await Promise.all([
    notificationFeed(user.id, 80),
    prisma.user.findUnique({ where: { id: user.id }, select: { notificationsSeenAt: true } }),
  ]);
  return NextResponse.json(
    { seenAt: me?.notificationsSeenAt ?? null, notes },
    { headers: { "cache-control": "no-store" } },
  );
}
