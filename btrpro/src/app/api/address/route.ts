import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { addressAt, suggestAddresses } from "@/lib/integrations/address";

export async function GET(req: Request) {
  if (!(await getCurrentUser())) return NextResponse.json({ suggestions: [] }, { status: 401 });
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  const near = Number.isFinite(lat) && Number.isFinite(lon) && lat && lon ? { lat, lon } : undefined;
  try {
    if (url.searchParams.get("reverse") && near) return NextResponse.json({ address: await addressAt(near.lat, near.lon) });
    return NextResponse.json({ suggestions: await suggestAddresses(url.searchParams.get("q") ?? "", near) });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
