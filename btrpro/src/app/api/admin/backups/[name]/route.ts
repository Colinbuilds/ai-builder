import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { backupPath } from "@/lib/backup";

// Download one backup (admins only).
export async function GET(_: Request, { params }: { params: Promise<{ name: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") return new NextResponse("Admins only", { status: 403 });
  const { name } = await params;
  const file = backupPath(name);
  if (!file) return new NextResponse("Not found", { status: 404 });
  const bytes = await readFile(file).catch(() => null);
  if (!bytes) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${name}"` } });
}
