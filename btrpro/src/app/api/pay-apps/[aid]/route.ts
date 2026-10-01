import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { payAppPdf } from "@/lib/billing/payapps";

export async function GET(_: Request, { params }: { params: Promise<{ aid: string }> }) {
  if (!(await getCurrentUser())) return new NextResponse("Not found", { status: 404 });
  const { aid } = await params;
  const a = await prisma.payApp.findUnique({ where: { id: aid }, include: { contract: { select: { project: true } } } });
  if (!a) return new NextResponse("Not found", { status: 404 });
  const name = `${a.contract.project} - Application ${a.number}`.replace(/[^\w .-]+/g, "");
  return new NextResponse(Buffer.from(await payAppPdf(aid)), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}.pdf"` } });
}
