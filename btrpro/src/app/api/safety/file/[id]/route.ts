import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readUpload } from "@/lib/storage";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u || u.role === "VIEWER") return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const f = await prisma.companyFile.findUnique({ where: { id: (await params).id } });
  if (!f) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(await readUpload(f.fileUrl)), { headers: { "content-type": f.contentType ?? "application/octet-stream", "content-disposition": `inline; filename="${f.title.replace(/[^\w .-]/g, "")}"` } });
}
