import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

// Everything except /login, the public token pages, the crew portal (its own login), and static assets requires a signed-in user.
export async function middleware(req: NextRequest) {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|crew(?:/|$)|api/crew/|p/|w/|i/|co/|c/|portal/|quote(?:/|$)|api/q/|api/p/|api/i/|api/stripe/|api/inbound-email|_next/static|_next/image|favicon.ico).*)"],
};
