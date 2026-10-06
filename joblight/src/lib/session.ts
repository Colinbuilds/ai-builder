// Console sign-in: one operator account from env (CONSOLE_EMAIL / CONSOLE_PASSWORD), a signed cookie, no database.
// Uses Web Crypto so the middleware (edge runtime) can verify it too.
export const SESSION_COOKIE = "jl_console";
const MAX_AGE_S = 60 * 60 * 24 * 14;

const enc = new TextEncoder();
const dec = new TextDecoder();
// base64url without Buffer (not available in the edge runtime)
const toB64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function key(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set (32+ characters).");
  return s;
}

export async function signSession(email: string, now = Date.now()): Promise<string> {
  const body = toB64url(enc.encode(JSON.stringify({ email, exp: Math.floor(now / 1000) + MAX_AGE_S })));
  const sig = await crypto.subtle.sign("HMAC", await key(secret()), enc.encode(body));
  return `${body}.${toB64url(new Uint8Array(sig))}`;
}

export async function verifySession(token: string | undefined, now = Date.now()): Promise<{ email: string } | null> {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  try {
    // a missing AUTH_SECRET throws here and reads as signed out
    const ok = await crypto.subtle.verify("HMAC", await key(secret()), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const data = JSON.parse(dec.decode(fromB64url(body))) as { email: string; exp: number };
    if (data.exp * 1000 < now) return null;
    return { email: data.email };
  } catch {
    return null;
  }
}

export const SESSION_MAX_AGE = MAX_AGE_S;
