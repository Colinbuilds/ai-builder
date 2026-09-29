// OAuth 2.0 connections for integrations. Tokens are encrypted at rest; refresh happens automatically.
import { prisma } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";

export type OAuthProvider = "GOOGLE_DRIVE" | "QUICKBOOKS" | "PROCORE";

type Cfg = {
  label: string;
  auth: string;
  token: string;
  scope: string;
  clientId: () => string | undefined;
  clientSecret: () => string | undefined;
  /** true = each user connects their own account; false = one company-wide connection (Admin) */
  perUser: boolean;
  basicAuth?: boolean;
  extraAuthParams?: Record<string, string>;
};

export const OAUTH: Record<OAuthProvider, Cfg> = {
  GOOGLE_DRIVE: {
    label: "Google Drive",
    auth: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file openid email",
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    perUser: true,
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },
  QUICKBOOKS: {
    label: "QuickBooks Online",
    auth: "https://appcenter.intuit.com/connect/oauth2",
    token: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    scope: "com.intuit.quickbooks.accounting",
    clientId: () => process.env.QBO_CLIENT_ID,
    clientSecret: () => process.env.QBO_CLIENT_SECRET,
    perUser: false,
    basicAuth: true,
  },
  PROCORE: {
    label: "Procore",
    auth: "https://login.procore.com/oauth/authorize",
    token: "https://login.procore.com/oauth/token",
    scope: "",
    clientId: () => process.env.PROCORE_CLIENT_ID,
    clientSecret: () => process.env.PROCORE_CLIENT_SECRET,
    perUser: false,
  },
};

export const isOAuthProvider = (p: string): p is OAuthProvider => p in OAUTH;
export const oauthConfigured = (p: OAuthProvider) => !!(OAUTH[p].clientId() && OAUTH[p].clientSecret() && process.env.APP_URL);
export const redirectUri = (p: OAuthProvider) => `${process.env.APP_URL}/api/integrations/${p.toLowerCase()}/callback`;

export function authorizeUrl(p: OAuthProvider, state: string) {
  const c = OAUTH[p];
  const q = new URLSearchParams({
    client_id: c.clientId()!,
    redirect_uri: redirectUri(p),
    response_type: "code",
    state,
    ...(c.scope ? { scope: c.scope } : {}),
    ...(c.extraAuthParams ?? {}),
  });
  return `${c.auth}?${q}`;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number };

async function tokenRequest(p: OAuthProvider, body: Record<string, string>): Promise<TokenResponse> {
  const c = OAUTH[p];
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  const params = new URLSearchParams(body);
  if (c.basicAuth) headers.authorization = `Basic ${Buffer.from(`${c.clientId()}:${c.clientSecret()}`).toString("base64")}`;
  else {
    params.set("client_id", c.clientId()!);
    params.set("client_secret", c.clientSecret()!);
  }
  const res = await fetch(c.token, { method: "POST", headers, body: params });
  if (!res.ok) throw new Error(`${c.label} sign-in failed (${res.status}).`);
  return res.json();
}

export async function completeOAuth(p: OAuthProvider, userId: string, code: string, extra: Record<string, string> = {}) {
  const t = await tokenRequest(p, { grant_type: "authorization_code", code, redirect_uri: redirectUri(p) });
  const owner = OAUTH[p].perUser ? userId : null;
  const data = {
    accessToken: encrypt(t.access_token),
    refreshToken: t.refresh_token ? encrypt(t.refresh_token) : null,
    expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
    extra: Object.keys(extra).length ? extra : undefined,
    accountLabel: extra.realmId ? `Company ${extra.realmId}` : null,
  };
  const existing = await prisma.integrationConnection.findFirst({ where: { provider: p, userId: owner } });
  return existing
    ? prisma.integrationConnection.update({ where: { id: existing.id }, data })
    : prisma.integrationConnection.create({ data: { provider: p, userId: owner, ...data } });
}

export async function getConnection(p: OAuthProvider, userId: string) {
  return prisma.integrationConnection.findFirst({ where: { provider: p, userId: OAUTH[p].perUser ? userId : null } });
}

/** A valid access token for the provider, refreshing it if needed. */
export async function accessToken(p: OAuthProvider, userId: string): Promise<{ token: string; extra: Record<string, string> }> {
  const conn = await getConnection(p, userId);
  if (!conn) throw new Error(`${OAUTH[p].label} isn't connected.`);
  const extra = (conn.extra as Record<string, string> | null) ?? {};
  if (!conn.expiresAt || conn.expiresAt.getTime() > Date.now() + 60_000) return { token: decrypt(conn.accessToken), extra };
  if (!conn.refreshToken) throw new Error(`${OAUTH[p].label} connection expired. Reconnect it.`);
  const t = await tokenRequest(p, { grant_type: "refresh_token", refresh_token: decrypt(conn.refreshToken) });
  await prisma.integrationConnection.update({
    where: { id: conn.id },
    data: {
      accessToken: encrypt(t.access_token),
      ...(t.refresh_token ? { refreshToken: encrypt(t.refresh_token) } : {}),
      expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
    },
  });
  return { token: t.access_token, extra };
}
