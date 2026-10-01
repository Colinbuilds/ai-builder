import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentCrew } from "@/lib/crew/auth";
import { prisma } from "@/lib/db";
import { readUpload } from "@/lib/storage";

/** The file attached to a crew invoice: staff (not viewers), or the crew that sent it. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inv = await prisma.crewInvoice.findUnique({ where: { id } });
  if (!inv?.fileUrl) return new NextResponse("Not found", { status: 404 });
  const staff = await getCurrentUser();
  if (staff?.role === "VIEWER") return new NextResponse("Not found", { status: 404 });
  if (!staff) {
    const crew = await getCurrentCrew();
    if (!crew || inv.crewId !== crew.id) return new NextResponse("Not found", { status: 404 });
  }
  return new NextResponse(new Uint8Array(await readUpload(inv.fileUrl)), {
    headers: { "content-type": inv.contentType ?? "application/octet-stream", "content-disposition": "inline", "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
}
