import { NextResponse } from "next/server";
import { leadByToken, type Photo, type Rendering } from "@/lib/leads/web";
import { readUpload } from "@/lib/storage";
import { resized } from "@/lib/photos/images";

// The customer's photos and renderings, authorized by their request link. ?w=400 for a thumbnail.
export async function GET(req: Request, { params }: { params: Promise<{ token: string; kind: string; n: string }> }) {
  const { token, kind, n } = await params;
  const lead = await leadByToken(token);
  const list = kind === "photo" ? (lead?.photos as Photo[] | undefined) : kind === "render" ? (lead?.renderings as Rendering[] | null | undefined) : null;
  const item = list?.[Number(n)];
  if (!item?.url) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = await readUpload(item.url);
  const w = Number(new URL(req.url).searchParams.get("w"));
  const out = w > 0 && w < 2000 ? ((await resized(bytes, w, 78)) ?? bytes) : bytes;
  return new NextResponse(new Uint8Array(out), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" } });
}
