import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { getCurrentUser } from "@/lib/auth";
import { authorizeUrl, isOAuthProvider, OAUTH, oauthConfigured } from "@/lib/integrations/oauth";

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const p = (await params).provider.toUpperCase();
  if (!isOAuthProvider(p)) return NextResponse.json({ error: "unknown integration" }, { status: 404 });
  if (!OAUTH[p].perUser && user.role !== "ADMIN") return NextResponse.json({ error: "Only an Admin can connect this." }, { status: 403 });
  if (!oauthConfigured(p)) return NextResponse.json({ error: `${OAUTH[p].label} isn't configured on this server.` }, { status: 400 });
  const back = new URL(req.url).searchParams.get("returnTo") ?? "/settings/integrations";
  const state = await new SignJWT({ uid: user.id, back: back.startsWith("/") ? back : "/" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  return NextResponse.redirect(authorizeUrl(p, state));
}
