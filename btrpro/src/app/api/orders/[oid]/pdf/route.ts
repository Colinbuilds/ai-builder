import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { orderPdf } from "@/lib/orders/service";

export async function GET(_: Request, { params }: { params: Promise<{ oid: string }> }) {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const o = await prisma.materialOrder.findUnique({ where: { id: (await params).oid } });
  if (!o) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(Buffer.from(await orderPdf(o.id)), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${o.number}.pdf"` } });
}
