import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { getCurrentUser } from "@/lib/auth";
import { authorizeUrl, providerConfigured, type Provider } from "@/lib/comms/mailbox";

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const p = (await params).provider.toUpperCase() as Provider;
  if (p !== "GOOGLE" && p !== "MICROSOFT") return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  if (!providerConfigured(p)) return NextResponse.json({ error: `${p} mail connection isn't configured on this server.` }, { status: 400 });
  const back = new URL(req.url).searchParams.get("returnTo") ?? "/";
  const state = await new SignJWT({ uid: user.id, back: back.startsWith("/") ? back : "/" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  return NextResponse.redirect(authorizeUrl(p, state));
}
