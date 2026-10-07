import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { builderStatement, statementCsv } from "@/lib/builders/statement";

export async function GET(req: Request, { params }: { params: Promise<{ bid: string }> }) {
  const user = await getCurrentUser();
  if (!user || !["ADMIN", "OFFICE", "ESTIMATOR"].includes(user.role)) return new NextResponse("Not allowed", { status: 403 });
  const { bid } = await params;
  const m = new URL(req.url).searchParams.get("m") ?? "";
  if (!/^\d{4}-\d{2}$/.test(m)) return new NextResponse("Pick a month", { status: 400 });
  const s = await builderStatement(bid, m);
  return new NextResponse(statementCsv(s), { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${s.company.name.replace(/[^\w ]+/g, "")} statement ${m}.csv"` } });
}
