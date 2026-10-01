import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readUpload } from "@/lib/storage";
import { resized } from "@/lib/photos/images";

/** Photo n of a crew-reported field issue, for staff. ?w=400 gives a thumbnail. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; n: string }> }) {
  if (!(await getCurrentUser())) return new NextResponse("Not found", { status: 404 });
  const { id, n } = await params;
  const issue = await prisma.fieldIssue.findUnique({ where: { id }, select: { photos: true } });
  const ph = ((issue?.photos as { url: string }[] | null) ?? [])[Number(n)];
  if (!ph) return new NextResponse("Not found", { status: 404 });
  const bytes = await readUpload(ph.url);
  const w = Number(req.nextUrl.searchParams.get("w"));
  const small = await resized(bytes, w > 0 ? Math.min(Math.max(w, 100), 1600) : 1600, 80);
  return new NextResponse(new Uint8Array(small ?? bytes), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" } });
}
