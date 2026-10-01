import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readUpload } from "@/lib/storage";

/** One photo/page of a scanned receipt (staff only). */
export async function GET(_: Request, { params }: { params: Promise<{ rid: string; n: string }> }) {
  await requireUser(["ADMIN", "ESTIMATOR"]);
  const { rid, n } = await params;
  const scan = await prisma.receiptScan.findUnique({ where: { id: rid }, select: { files: true } });
  const f = (scan?.files as { url: string; type: string }[] | undefined)?.[Number(n)];
  if (!f) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(await readUpload(f.url)), { headers: { "content-type": f.type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
}
