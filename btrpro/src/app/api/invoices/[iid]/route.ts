import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canSeeCosts } from "@/lib/costing/service";
import { invoicePdf } from "@/lib/billing/service";

// Staff copy of an invoice PDF (drafts included).
export async function GET(
  _: Request,
  { params }: { params: Promise<{ iid: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const inv = await prisma.invoice.findUnique({
    where: { id: (await params).iid },
    include: {
      project: { select: { estimatorId: true, salespersonId: true } },
    },
  });
  if (!inv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canSeeCosts(user, inv.project))
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  return new NextResponse(Buffer.from(await invoicePdf(inv.id)), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${inv.number}.pdf"`,
    },
  });
}
