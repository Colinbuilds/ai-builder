import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readUpload } from "@/lib/storage";

// The builder's start-sheet PDF as uploaded.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Sign in", { status: 401 });
  const s = await prisma.builderStart.findUnique({ where: { id: (await params).id } });
  if (!s) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(await readUpload(s.fileUrl)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${s.fileName.replace(/[^\w .-]+/g, " ")}"` } });
}
