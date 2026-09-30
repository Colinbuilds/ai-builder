import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { estimatePdf, loadBundle, orderCsv, takeoffPdf } from "@/lib/outputs/estimate";

const fileBase = (s: string) => s.replace(/[^\w\- ]+/g, "").replace(/\s+/g, "_").slice(0, 80);

// /api/estimates/:id/estimate.pdf | takeoff.pdf | order.csv  (Admin / Estimator — these show costs)
export async function GET(_: Request, { params }: { params: Promise<{ eid: string; output: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  if (user.role === "VIEWER") return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const { eid, output } = await params;
  const b = await loadBundle(eid);
  const name = fileBase(`${b.e.project.name} ${b.e.name}`);
  if (output === "order.csv")
    return new NextResponse(orderCsv(b), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}_order.csv"` } });
  if (output === "estimate.pdf" || output === "takeoff.pdf") {
    const bytes = output === "estimate.pdf" ? await estimatePdf(b) : await takeoffPdf(b);
    return new NextResponse(Buffer.from(bytes), {
      headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}_${output}"` },
    });
  }
  return NextResponse.json({ error: "Unknown output" }, { status: 404 });
}
