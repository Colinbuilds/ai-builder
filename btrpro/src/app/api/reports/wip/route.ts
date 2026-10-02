import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { wipCsv, wipSchedule } from "@/lib/reports/wip";

export async function GET() {
  const u = await getCurrentUser();
  if (!u || !["ADMIN", "OFFICE", "ESTIMATOR"].includes(u.role)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const csv = wipCsv(await wipSchedule(u));
  return new NextResponse(csv, { headers: { "content-type": "text/csv", "content-disposition": `attachment; filename="BTR-WIP-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
