// Job email: parse inbound webhooks, attach messages to jobs, de-duplicate, keep attachments.
import { prisma } from "@/lib/db";
import { addDocument } from "@/lib/docs/documents";

export type EmailAttachment = { name: string; contentType: string; bytes: Uint8Array };
export type NormalizedEmail = {
  externalId: string | null;
  threadId: string | null;
  from: string;
  to: string | null;
  subject: string;
  sentAt: Date;
  bodyText: string;
  attachments: EmailAttachment[];
};

const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
export function htmlToText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Job addresses look like job-<emailToken>@<INBOUND_EMAIL_DOMAIN>. */
export function jobTokensFromAddresses(addresses: string[]) {
  const out = new Set<string>();
  for (const a of addresses) {
    const m = a.toLowerCase().match(/job-([a-z0-9]+)@/);
    if (m) out.add(m[1]);
  }
  return [...out];
}

type Rec = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Accepts Postmark's inbound JSON, or a generic JSON body:
 * { from, to: string[], cc?, subject, text?, html?, date?, messageId?, inReplyTo?, attachments?: [{ name, contentType, contentBase64 }] }
 */
export function parseInboundPayload(p: Rec): { recipients: string[]; email: NormalizedEmail } {
  const isPostmark = "FromFull" in p || "TextBody" in p || "MessageID" in p;
  if (isPostmark) {
    const addrs = (k: string) => (Array.isArray(p[k]) ? (p[k] as Rec[]).map((x) => s(x.Email)) : []);
    const recipients = [...addrs("ToFull"), ...addrs("CcFull"), ...addrs("BccFull"), s(p.OriginalRecipient)].filter(Boolean);
    const headers = Array.isArray(p.Headers) ? (p.Headers as Rec[]) : [];
    const header = (n: string) => s(headers.find((h) => s(h.Name).toLowerCase() === n)?.Value) || null;
    const messageId = header("message-id") || s(p.MessageID) || null;
    const fromFull = (p.FromFull as Rec | undefined) ?? {};
    return {
      recipients,
      email: {
        externalId: messageId,
        threadId: header("in-reply-to") || header("references")?.split(/\s+/)[0] || messageId,
        from: s(fromFull.Name) ? `${s(fromFull.Name)} <${s(fromFull.Email)}>` : s(p.From),
        to: s(p.To) || null,
        subject: s(p.Subject) || "(no subject)",
        sentAt: p.Date ? new Date(s(p.Date)) : new Date(),
        bodyText: s(p.TextBody) || htmlToText(s(p.HtmlBody)) || s(p.StrippedTextReply),
        attachments: (Array.isArray(p.Attachments) ? (p.Attachments as Rec[]) : []).map((a) => ({
          name: s(a.Name) || "attachment",
          contentType: s(a.ContentType) || "application/octet-stream",
          bytes: Buffer.from(s(a.Content), "base64"),
        })),
      },
    };
  }
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(/[,;]/) : []).map((x) => x.trim());
  const recipients = [...list(p.to), ...list(p.cc)].filter(Boolean);
  const messageId = s(p.messageId) || null;
  const sent = p.date ? new Date(s(p.date)) : new Date();
  return {
    recipients,
    email: {
      externalId: messageId,
      threadId: s(p.inReplyTo) || messageId,
      from: s(p.from),
      to: recipients.join(", ") || null,
      subject: s(p.subject) || "(no subject)",
      sentAt: Number.isNaN(sent.getTime()) ? new Date() : sent,
      bodyText: s(p.text) || htmlToText(s(p.html)),
      attachments: (Array.isArray(p.attachments) ? (p.attachments as Rec[]) : []).map((a) => ({
        name: s(a.name) || "attachment",
        contentType: s(a.contentType) || "application/octet-stream",
        bytes: Buffer.from(s(a.contentBase64), "base64"),
      })),
    },
  };
}

const MAX_ATTACHMENT = 25 * 1024 * 1024;

/** Stores an email on a job. Returns null when the same message is already on the job. */
export async function ingestEmail(
  projectId: string,
  source: "FORWARDED" | "GMAIL" | "MANUAL",
  e: NormalizedEmail,
  addedById: string | null,
) {
  if (e.externalId) {
    const dup = await prisma.jobEmail.findUnique({ where: { projectId_externalId: { projectId, externalId: e.externalId } } });
    if (dup) return null;
  }
  if (!e.from.trim()) throw new Error("Sender is required.");
  if (!e.bodyText.trim() && !e.attachments.length) throw new Error("The email has no text.");
  const email = await prisma.jobEmail.create({
    data: {
      projectId,
      source,
      externalId: e.externalId,
      threadId: e.threadId,
      fromAddr: e.from.trim(),
      toAddrs: e.to,
      subject: e.subject.trim() || "(no subject)",
      sentAt: Number.isNaN(e.sentAt.getTime()) ? new Date() : e.sentAt,
      bodyText: e.bodyText,
      addedById,
    },
  });
  for (const a of e.attachments) {
    if (!a.bytes.length || a.bytes.length > MAX_ATTACHMENT) continue;
    const { doc } = await addDocument({ projectId, bytes: a.bytes, fileName: a.name, contentType: a.contentType, source: "EMAIL", userId: addedById });
    await prisma.document.update({ where: { id: doc.id }, data: { jobEmailId: email.id } });
  }
  await prisma.projectActivity.create({
    data: {
      projectId,
      userId: addedById,
      kind: "email",
      text: `Email from ${email.fromAddr}: "${email.subject}"${e.attachments.length ? ` (${e.attachments.length} attachment${e.attachments.length === 1 ? "" : "s"})` : ""}`,
    },
  });
  return email;
}

/** Search words used to find this job's email in a connected mailbox. */
export function defaultMailQuery(p: { name: string; claimNumber: string | null; address: string | null; acculynxJobNumber: string | null }) {
  const parts: string[] = [];
  if (p.claimNumber) parts.push(`"${p.claimNumber}"`);
  if (p.acculynxJobNumber) parts.push(`"${p.acculynxJobNumber}"`);
  const street = p.address?.split(",")[0]?.trim();
  if (street && /\d/.test(street)) parts.push(`"${street}"`);
  if (!parts.length) parts.push(`"${p.name.split(/[—–-]/)[0].trim()}"`);
  return parts.join(" OR ");
}
