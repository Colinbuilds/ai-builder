import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readUpload } from "@/lib/storage";

/** A builder house's work order (kind "wo", per scope line) or plan set (kind "plan"). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const { id, kind } = await params;
  const l = await prisma.prodLine.findUnique({ where: { id }, select: { workOrderUrl: true, planUrl: true, vpo: true, location: true, type: true } });
  const url = kind === "plan" ? l?.planUrl : kind === "wo" ? l?.workOrderUrl : null;
  if (!l || !url) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const name = (kind === "plan" ? `${l.location} plans` : `${l.location} ${l.type} work order ${l.vpo ?? ""}`).replace(/[^\w .-]/g, "").trim();
  return new NextResponse(new Uint8Array(await readUpload(url)), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}.pdf"` } });
}
