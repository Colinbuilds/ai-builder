import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { photoBytes } from "@/lib/integrations/drive-photos";

// Job photos from Drive, for signed-in staff only, and only from folders linked to a job.
export async function GET(req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const s = Number(new URL(req.url).searchParams.get("s"));
  try {
    const p = await photoBytes((await params).fileId, s > 0 && s <= 1600 ? Math.round(s) : null, user.id);
    if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return new NextResponse(p.bytes, { headers: { "content-type": p.type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
