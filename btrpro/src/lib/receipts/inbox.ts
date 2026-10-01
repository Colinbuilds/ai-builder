// Receipts by email: anything sent to receipts@<INBOUND_EMAIL_DOMAIN> by a BTR staff member or crew login
// becomes a receipt to review. The sender is the employee; the subject and message help match the job.
import { prisma } from "@/lib/db";
import type { NormalizedEmail } from "@/lib/comms/email";
import { readReceipt, saveReceiptFiles } from "./service";

export const RECEIPTS_LOCAL = () => (process.env.RECEIPTS_INBOX ?? "receipts").toLowerCase();
export const receiptsAddress = () => (process.env.INBOUND_EMAIL_DOMAIN ? `${RECEIPTS_LOCAL()}@${process.env.INBOUND_EMAIL_DOMAIN}` : null);

export const isReceiptsAddress = (addresses: string[]) => addresses.some((a) => new RegExp(`(^|<|\\s)${RECEIPTS_LOCAL()}@`, "i").test(a.trim()));

const senderEmail = (from: string) => (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
const senderName = (from: string) => from.replace(/<[^>]+>/, "").replace(/"/g, "").trim();
/** The new part of the message: stops at the quoted reply/forward header and the signature line. */
export const messageText = (body: string) => body.split(/\n(?:On .{5,120} wrote:|-{2,}\s*Original Message|From: .+\nSent: |-- ?\n)/)[0].trim().slice(0, 2000);

/** Returns the receipt ids created, or a reason it was ignored. */
export async function receiptsFromEmail(email: NormalizedEmail): Promise<{ ids: string[]; ignored?: string }> {
  const addr = senderEmail(email.from);
  const user = await prisma.user.findUnique({ where: { email: addr }, select: { id: true, name: true } });
  const crew = user ? null : await prisma.crew.findFirst({ where: { active: true, OR: [{ loginEmail: addr }, { email: addr }] }, select: { id: true, name: true } });
  if (!user && !crew) return { ids: [], ignored: `sender ${addr} isn't a BTR staff or crew email` };
  if (email.externalId && (await prisma.receiptScan.findFirst({ where: { emailId: email.externalId } }))) return { ids: [], ignored: "already received" };
  const files = email.attachments.filter((a) => /^(image\/|application\/pdf)/i.test(a.contentType) || /\.(jpe?g|png|heic|webp|pdf)$/i.test(a.name));
  if (!files.length) return { ids: [], ignored: "no photo or PDF attached" };
  const from = {
    source: "EMAIL" as const,
    employeeId: user?.id ?? null,
    employee: user?.name ?? `${crew!.name}${senderName(email.from) ? ` (${senderName(email.from)})` : ""}`,
    subject: email.subject,
    message: messageText(email.bodyText ?? ""),
    emailId: email.externalId,
  };
  // one receipt per email: several attachments are pages of the same receipt unless there are many PDFs
  const groups = files.filter((f) => /pdf/i.test(f.contentType)).length > 1 ? files.map((f) => [f]) : [files.slice(0, 6)];
  const ids: string[] = [];
  for (const g of groups) {
    try {
      ids.push(await saveReceiptFiles(g.map((f) => ({ bytes: new Uint8Array(f.bytes), name: f.name })), { ...from, emailId: groups.length > 1 ? `${email.externalId ?? ""}#${ids.length}` : email.externalId }, user?.id ?? `crew:${crew!.id}`));
    } catch (e) {
      console.error("receipt email attachment rejected", e);
    }
  }
  // read in the background so the email provider gets its answer right away
  for (const id of ids) void readReceipt(id).catch((e) => console.error("receipt read failed", id, e));
  return { ids };
}
