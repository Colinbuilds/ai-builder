import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { proposalPdf } from "@/lib/proposals/pdf";

export async function GET(_: Request, { params }: { params: Promise<{ pid: string }> }) {
  const u = await getCurrentUser();
  if (!u || u.role === "VIEWER") return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const p = await prisma.proposal.findUnique({ where: { id: (await params).pid } });
  if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(Buffer.from(await proposalPdf(p)), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${p.number}.pdf"` } });
}
