// Company-wide Google Drive access with a service account, so the app reads Drive on its own
// (price-sheet sync, schedule import, document import) without anyone connecting their account.
// Setup: create a service account in Google Cloud, enable the Drive API, put its JSON key in
// GOOGLE_SERVICE_ACCOUNT_JSON (raw JSON or base64), and share the Drive folders / shared drives with its email.
import { createSign } from "node:crypto";
import { accessToken, getConnection, oauthConfigured } from "./oauth";

type Key = { client_email: string; private_key: string; token_uri?: string };
const SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export function serviceAccountKey(): Key | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const k = JSON.parse(json) as Key;
    if (!k.client_email || !k.private_key) return null;
    return { ...k, private_key: k.private_key.replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
}
export const serviceAccountEmail = () => serviceAccountKey()?.client_email ?? null;

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** Signed JWT assertion for Google's token endpoint (RFC 7523). */
export function serviceAccountAssertion(k: Key, now = Math.floor(Date.now() / 1000)) {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: k.client_email, scope: SCOPE, aud: k.token_uri ?? "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(k.private_key);
  return `${head}.${body}.${b64url(sig)}`;
}

let cached: { token: string; until: number } | null = null;
async function serviceAccountToken(k: Key) {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const res = await fetch(k.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: serviceAccountAssertion(k) }),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(`Google service account sign-in failed: ${j.error_description ?? res.status}. Check GOOGLE_SERVICE_ACCOUNT_JSON and that the Drive API is enabled.`);
  cached = { token: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

/** A Drive access token: the company service account when set up, else the user's own connection. */
export async function driveToken(userId: string | null): Promise<string> {
  const k = serviceAccountKey();
  if (k) return serviceAccountToken(k);
  if (!userId) throw new Error("Google Drive isn't set up for the app (no service account) and no one's Drive account is connected.");
  return (await accessToken("GOOGLE_DRIVE", userId)).token;
}

/** Can this user use Drive right now? */
export async function driveAvailable(userId: string) {
  if (serviceAccountKey()) return true;
  return oauthConfigured("GOOGLE_DRIVE") && !!(await getConnection("GOOGLE_DRIVE", userId));
}

/** Friendlier 404: with a service account, "not found" almost always means the folder isn't shared with it. */
export function driveNotFound() {
  const sa = serviceAccountEmail();
  return sa ? `Drive can't see that file. Share it (or its folder / shared drive) with ${sa} as a Viewer.` : "Drive says that file doesn't exist or isn't shared with your account.";
}
