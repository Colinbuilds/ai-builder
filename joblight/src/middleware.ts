import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

// The console is the operator's only; the public site is open.
export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname === "/console/login") return NextResponse.next();
  if (await verifySession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/console/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/console/:path*"] };
