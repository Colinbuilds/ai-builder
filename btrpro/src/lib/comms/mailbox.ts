// Pulling job email from a connected Gmail or Microsoft 365 mailbox (read-only scopes).
// Needs GOOGLE_CLIENT_ID/SECRET or MS_CLIENT_ID/SECRET plus APP_URL for the OAuth redirect.
import { prisma } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { htmlToText, type NormalizedEmail } from "./email";

export type Provider = "GOOGLE" | "MICROSOFT";

const CFG = {
  GOOGLE: {
    auth: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/gmail.readonly openid email",
    id: () => process.env.GOOGLE_CLIENT_ID,
    secret: () => process.env.GOOGLE_CLIENT_SECRET,
  },
  MICROSOFT: {
    auth: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "offline_access Mail.Read User.Read",
    id: () => process.env.MS_CLIENT_ID,
    secret: () => process.env.MS_CLIENT_SECRET,
  },
} as const;

export const providerConfigured = (p: Provider) => !!(CFG[p].id() && CFG[p].secret() && process.env.APP_URL);
const redirectUri = (p: Provider) => `${process.env.APP_URL}/api/mail/${p.toLowerCase()}/callback`;

export function authorizeUrl(p: Provider, state: string) {
  const c = CFG[p];
  const q = new URLSearchParams({
    client_id: c.id()!,
    redirect_uri: redirectUri(p),
    response_type: "code",
    scope: c.scope,
    state,
    ...(p === "GOOGLE" ? { access_type: "offline", prompt: "consent" } : {}),
  });
  return `${c.auth}?${q}`;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number; id_token?: string };

async function tokenRequest(p: Provider, body: Record<string, string>): Promise<TokenResponse> {
  const c = CFG[p];
  const res = await fetch(c.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.id()!, client_secret: c.secret()!, ...body }),
  });
  if (!res.ok) throw new Error(`${p === "GOOGLE" ? "Google" : "Microsoft"} sign-in failed (${res.status}).`);
  return res.json();
}

export async function connectMailbox(p: Provider, userId: string, code: string) {
  const t = await tokenRequest(p, { grant_type: "authorization_code", code, redirect_uri: redirectUri(p) });
  const email = await mailboxAddress(p, t.access_token);
  const data = {
    email,
    accessToken: encrypt(t.access_token),
    refreshToken: t.refresh_token ? encrypt(t.refresh_token) : null,
    expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
  };
  return prisma.mailboxConnection.upsert({
    where: { userId_provider: { userId, provider: p } },
    update: data,
    create: { userId, provider: p, ...data },
  });
}

async function mailboxAddress(p: Provider, token: string) {
  const url = p === "GOOGLE" ? "https://gmail.googleapis.com/gmail/v1/users/me/profile" : "https://graph.microsoft.com/v1.0/me";
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("Couldn't read the mailbox address.");
  const j = await res.json();
  return String(p === "GOOGLE" ? j.emailAddress : (j.mail ?? j.userPrincipalName));
}

async function accessToken(conn: { id: string; provider: Provider; accessToken: string; refreshToken: string | null; expiresAt: Date | null }) {
  if (conn.expiresAt && conn.expiresAt.getTime() > Date.now() + 60_000) return decrypt(conn.accessToken);
  if (!conn.refreshToken) throw new Error("Mailbox connection expired. Reconnect it.");
  const t = await tokenRequest(conn.provider, { grant_type: "refresh_token", refresh_token: decrypt(conn.refreshToken) });
  await prisma.mailboxConnection.update({
    where: { id: conn.id },
    data: {
      accessToken: encrypt(t.access_token),
      ...(t.refresh_token ? { refreshToken: encrypt(t.refresh_token) } : {}),
      expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
    },
  });
  return t.access_token;
}

// ---------- Gmail ----------

type GmailPart = { mimeType?: string; filename?: string; body?: { data?: string; attachmentId?: string; size?: number }; parts?: GmailPart[]; headers?: { name: string; value: string }[] };
export type GmailMessage = { id: string; threadId: string; internalDate?: string; payload: GmailPart };

const b64url = (d: string) => Buffer.from(d.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

function walk(part: GmailPart, out: GmailPart[] = []) {
  out.push(part);
  for (const p of part.parts ?? []) walk(p, out);
  return out;
}

/** Turns a Gmail API message (format=full) into our email shape. Attachments are listed, fetched separately. */
export function parseGmailMessage(m: GmailMessage): NormalizedEmail & { attachmentRefs: { id: string; name: string; contentType: string }[] } {
  const h = (n: string) => m.payload.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? null;
  const parts = walk(m.payload);
  const plain = parts.find((p) => p.mimeType === "text/plain" && p.body?.data && !p.filename);
  const html = parts.find((p) => p.mimeType === "text/html" && p.body?.data && !p.filename);
  const date = h("date") ? new Date(h("date")!) : m.internalDate ? new Date(Number(m.internalDate)) : new Date();
  return {
    externalId: h("message-id") ?? `gmail:${m.id}`,
    threadId: m.threadId,
    from: h("from") ?? "",
    to: [h("to"), h("cc")].filter(Boolean).join(", ") || null,
    subject: h("subject") ?? "(no subject)",
    sentAt: Number.isNaN(date.getTime()) ? new Date() : date,
    bodyText: plain ? b64url(plain.body!.data!) : html ? htmlToText(b64url(html.body!.data!)) : "",
    attachments: [],
    attachmentRefs: parts
      .filter((p) => p.filename && p.body?.attachmentId)
      .map((p) => ({ id: p.body!.attachmentId!, name: p.filename!, contentType: p.mimeType ?? "application/octet-stream" })),
  };
}

// ---------- Microsoft Graph ----------

export type GraphMessage = {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  ccRecipients?: { emailAddress?: { address?: string } }[];
  sentDateTime?: string;
  receivedDateTime?: string;
  body?: { contentType?: "text" | "html"; content?: string };
  hasAttachments?: boolean;
};

export function parseGraphMessage(m: GraphMessage): NormalizedEmail {
  const f = m.from?.emailAddress;
  const recips = [...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])].map((r) => r.emailAddress?.address).filter(Boolean);
  const date = new Date(m.sentDateTime ?? m.receivedDateTime ?? Date.now());
  const content = m.body?.content ?? "";
  return {
    externalId: m.internetMessageId ?? `graph:${m.id}`,
    threadId: m.conversationId ?? null,
    from: f?.name ? `${f.name} <${f.address}>` : (f?.address ?? ""),
    to: recips.join(", ") || null,
    subject: m.subject || "(no subject)",
    sentAt: Number.isNaN(date.getTime()) ? new Date() : date,
    bodyText: m.body?.contentType === "html" ? htmlToText(content) : content,
    attachments: [],
  };
}

/** Finds messages matching the query in the user's mailbox (newest first, up to `limit`). */
export async function searchMailbox(userId: string, p: Provider, query: string, limit = 25): Promise<NormalizedEmail[]> {
  const conn = await prisma.mailboxConnection.findUnique({ where: { userId_provider: { userId, provider: p } } });
  if (!conn) throw new Error(`Connect your ${p === "GOOGLE" ? "Gmail" : "Microsoft 365"} mailbox first.`);
  const token = await accessToken(conn);
  const auth = { authorization: `Bearer ${token}` };
  if (p === "GOOGLE") {
    const list = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q: query, maxResults: String(limit) })}`,
      { headers: auth },
    );
    if (!list.ok) throw new Error(`Gmail search failed (${list.status}).`);
    const ids: { id: string }[] = (await list.json()).messages ?? [];
    const out: NormalizedEmail[] = [];
    for (const { id } of ids) {
      const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: auth });
      if (!r.ok) continue;
      const msg = parseGmailMessage(await r.json());
      for (const a of msg.attachmentRefs) {
        const ar = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/attachments/${a.id}`, { headers: auth });
        if (!ar.ok) continue;
        const data: string = (await ar.json()).data ?? "";
        msg.attachments.push({ name: a.name, contentType: a.contentType, bytes: Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64") });
      }
      out.push(msg);
    }
    return out;
  }
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages?${new URLSearchParams({
      $search: `"${query.replace(/"/g, "")}"`,
      $top: String(limit),
      $select: "id,internetMessageId,conversationId,subject,from,toRecipients,ccRecipients,sentDateTime,receivedDateTime,body,hasAttachments",
    })}`,
    { headers: { ...auth, ConsistencyLevel: "eventual" } },
  );
  if (!res.ok) throw new Error(`Microsoft 365 search failed (${res.status}).`);
  const items: GraphMessage[] = (await res.json()).value ?? [];
  const out: NormalizedEmail[] = [];
  for (const m of items) {
    const e = parseGraphMessage(m);
    if (m.hasAttachments) {
      const ar = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${m.id}/attachments`, { headers: auth });
      if (ar.ok) {
        for (const a of (await ar.json()).value ?? []) {
          if (a["@odata.type"] === "#microsoft.graph.fileAttachment" && a.contentBytes)
            e.attachments.push({ name: a.name, contentType: a.contentType ?? "application/octet-stream", bytes: Buffer.from(a.contentBytes, "base64") });
        }
      }
    }
    out.push(e);
  }
  return out;
}
