import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readUpload } from "@/lib/storage";

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  txt: "text/plain",
  csv: "text/csv",
};

// Serves a stored project document to signed-in users.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const doc = await prisma.document.findUnique({ where: { id: (await params).id } });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = await readUpload(doc.fileUrl);
  const ext = doc.fileName.split(".").pop()?.toLowerCase() ?? "";
  const inline = new URL(req.url).searchParams.get("download") == null && (ext === "pdf" || TYPES[ext]?.startsWith("image/"));
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": TYPES[ext] ?? "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${doc.fileName.replace(/"/g, "")}"`,
      "x-content-type-options": "nosniff",
    },
  });
}
