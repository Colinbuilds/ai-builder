import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getCurrentUser } from "@/lib/auth";
import { connectMailbox, type Provider } from "@/lib/comms/mailbox";

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const p = (await params).provider.toUpperCase() as Provider;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  let back = "/";
  try {
    const { payload } = await jwtVerify(url.searchParams.get("state") ?? "", new TextEncoder().encode(process.env.AUTH_SECRET));
    if (payload.uid !== user.id) throw new Error("state mismatch");
    back = String(payload.back ?? "/");
  } catch {
    return NextResponse.json({ error: "Sign-in link expired. Try connecting again." }, { status: 400 });
  }
  if (!code) return NextResponse.redirect(new URL(`${back}?mail=denied`, req.url));
  try {
    await connectMailbox(p, user.id, code);
  } catch (e) {
    return NextResponse.redirect(new URL(`${back}?mail=${encodeURIComponent(e instanceof Error ? e.message : "failed")}`, req.url));
  }
  return NextResponse.redirect(new URL(`${back}?mail=connected`, req.url));
}
