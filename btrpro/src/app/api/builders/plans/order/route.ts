import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { planOrderPdf } from "@/lib/builders/planbook";

// The Order tab posts its edited lines here and gets the PDF back; nothing is stored.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Sign in", { status: 401 });
  const f = await req.formData();
  const s = (k: string) => String(f.get(k) ?? "");
  const names = f.getAll("name").map(String);
  const qtys = f.getAll("qty").map(String);
  const units = f.getAll("unit").map(String);
  const sheet = { builder: s("builder"), model: s("model"), address: s("address"), po: s("po"), deliver: s("deliver"), color: s("color"), notes: s("notes"), lines: names.map((name, i) => ({ name, qty: qtys[i] ?? "", unit: units[i] ?? "" })) };
  const bytes = await planOrderPdf(sheet);
  const file = `Order ${sheet.model} ${sheet.address}`.replace(/[^\w .-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 90) || "Order";
  return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${file}.pdf"` } });
}
