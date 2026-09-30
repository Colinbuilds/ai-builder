import { NextResponse } from "next/server";
import { getByToken } from "@/lib/proposals/service";
import { proposalPdf } from "@/lib/proposals/pdf";

// Customer's copy, authorized by the proposal's secret link.
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const p = await getByToken((await params).token);
  if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(Buffer.from(await proposalPdf(p)), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${p.number}.pdf"` } });
}
