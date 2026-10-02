import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prequalPacket } from "@/lib/safety/service";

export async function GET() {
  const u = await getCurrentUser();
  if (!u || u.role === "VIEWER") return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const pdf = await prequalPacket();
  return new NextResponse(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="BTR-prequalification-${new Date().toISOString().slice(0, 10)}.pdf"` } });
}
