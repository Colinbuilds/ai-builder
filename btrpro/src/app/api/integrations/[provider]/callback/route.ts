import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { completeOAuth, isOAuthProvider, OAUTH } from "@/lib/integrations/oauth";

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const p = (await params).provider.toUpperCase();
  if (!isOAuthProvider(p)) return NextResponse.json({ error: "unknown integration" }, { status: 404 });
  const url = new URL(req.url);
  let back = "/settings/integrations";
  try {
    const { payload } = await jwtVerify(url.searchParams.get("state") ?? "", new TextEncoder().encode(process.env.AUTH_SECRET));
    if (payload.uid !== user.id) throw new Error("state mismatch");
    back = String(payload.back ?? back);
  } catch {
    return NextResponse.json({ error: "Sign-in link expired. Try connecting again." }, { status: 400 });
  }
  const code = url.searchParams.get("code");
  const sep = back.includes("?") ? "&" : "?";
  if (!code) return NextResponse.redirect(new URL(`${back}${sep}connected=denied`, req.url));
  try {
    // QuickBooks returns the company id as realmId on the callback.
    const realmId = url.searchParams.get("realmId");
    await completeOAuth(p, user.id, code, realmId ? { realmId } : {});
    await prisma.auditLog.create({ data: { userId: user.id, entity: "Integration", entityId: p, action: "connect" } });
  } catch (e) {
    return NextResponse.redirect(new URL(`${back}${sep}connected=${encodeURIComponent(e instanceof Error ? e.message : "failed")}`, req.url));
  }
  return NextResponse.redirect(new URL(`${back}${sep}connected=${encodeURIComponent(OAUTH[p].label)}`, req.url));
}
