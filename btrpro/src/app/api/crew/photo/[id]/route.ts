import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentCrew } from "@/lib/crew/auth";
import { prisma } from "@/lib/db";
import { readUpload } from "@/lib/storage";
import { resized } from "@/lib/photos/images";

/** A job photo for staff, or for the crew that took it. ?w=400 gives a small JPEG thumbnail. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const photo = await prisma.jobPhoto.findUnique({ where: { id } });
  if (!photo) return new NextResponse("Not found", { status: 404 });
  const staff = await getCurrentUser();
  if (!staff) {
    const crew = await getCurrentCrew();
    if (!crew || photo.crewId !== crew.id) return new NextResponse("Not found", { status: 404 });
  }
  const bytes = await readUpload(photo.fileUrl);
  const w = Number(req.nextUrl.searchParams.get("w"));
  if (w > 0) {
    const small = await resized(bytes, Math.min(Math.max(w, 100), 1600), 75);
    if (small) return new NextResponse(new Uint8Array(small), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } });
  }
  return new NextResponse(new Uint8Array(bytes), { headers: { "content-type": photo.contentType, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" } });
}
