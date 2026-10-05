import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prequalPacket } from "@/lib/safety/service";
import { shortName } from "@/lib/company-profile";

export async function GET() {
  const u = await getCurrentUser();
  if (!u || u.role === "VIEWER") return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const pdf = await prequalPacket();
  return new NextResponse(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${shortName().replace(/[^\w.-]+/g, "-")}-prequalification-${new Date().toISOString().slice(0, 10)}.pdf"` } });
}
