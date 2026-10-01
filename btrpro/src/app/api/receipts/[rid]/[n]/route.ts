import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readUpload } from "@/lib/storage";
import { cleanPage, type Rotate } from "@/lib/photos/document";
import { cropOf, type Saved } from "@/lib/receipts/service";

/**
 * One photo/page of a scanned receipt (staff only).
 *   (default)       the original photo
 *   ?v=clean        cropped to the paper, upright, contrast evened out — what the AI reads
 *   ?v=upright&r=90 the original turned by r degrees (for the crop tool)
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ rid: string; n: string }> }) {
  await requireUser(["ADMIN", "ESTIMATOR"]);
  const { rid, n } = await params;
  const scan = await prisma.receiptScan.findUnique({ where: { id: rid }, select: { files: true } });
  const f = (scan?.files as Saved[] | undefined)?.[Number(n)];
  if (!f) return new NextResponse("Not found", { status: 404 });
  const bytes = new Uint8Array(await readUpload(f.url));
  const v = req.nextUrl.searchParams.get("v");
  const headers = { "content-type": "image/jpeg", "cache-control": "private, no-cache", "x-content-type-options": "nosniff" };
  if (f.type !== "application/pdf" && v === "clean") {
    const page = await cleanPage(bytes, { crop: cropOf(f), rotate: f.rotate ?? 0 });
    return new NextResponse(new Uint8Array(page.data), { headers });
  }
  if (f.type !== "application/pdf" && v === "upright") {
    const r = Number(req.nextUrl.searchParams.get("r") ?? f.rotate ?? 0);
    const rot = ([0, 90, 180, 270].includes(r) ? r : 0) as Rotate;
    const out = await sharp(bytes, { failOn: "none" }).rotate().rotate(rot).resize({ width: 1400, height: 1400, fit: "inside" }).jpeg({ quality: 85 }).toBuffer();
    return new NextResponse(new Uint8Array(out), { headers });
  }
  return new NextResponse(new Uint8Array(bytes), { headers: { "content-type": f.type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
}
