// The company's uploaded logo (Settings → Company profile), shown on the top bar. Signed-in users only (middleware).
import { NextResponse } from "next/server";
import { companyLogo, getCompany } from "@/lib/company-profile";

export async function GET() {
  const logo = await companyLogo(await getCompany());
  if (!logo) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(logo.bytes), {
    headers: { "content-type": logo.type === "png" ? "image/png" : "image/jpeg", "cache-control": "public, max-age=300" },
  });
}
