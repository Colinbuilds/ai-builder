// Supplier bills by email: invoices sent or forwarded to bills@<INBOUND_EMAIL_DOMAIN> (ABC can send them there
// directly). Each PDF is its own bill; photos in one email are pages of one bill. Nothing is approved
// automatically — every bill is matched and waits for the office.
import { prisma } from "@/lib/db";
import type { NormalizedEmail } from "@/lib/comms/email";
import { messageText } from "@/lib/receipts/inbox";
import { readReceipt, saveReceiptFiles } from "@/lib/receipts/service";
import { openBill } from "./service";

export const BILLS_LOCAL = () => (process.env.BILLS_INBOX ?? "bills").toLowerCase();
export const billsAddress = () => (process.env.INBOUND_EMAIL_DOMAIN ? `${BILLS_LOCAL()}@${process.env.INBOUND_EMAIL_DOMAIN}` : null);
export const isBillsAddress = (addresses: string[]) => addresses.some((a) => new RegExp(`(^|<|\\s)${BILLS_LOCAL()}@`, "i").test(a.trim()));

export async function billsFromEmail(email: NormalizedEmail): Promise<{ ids: string[]; ignored?: string }> {
  if (email.externalId && (await prisma.receiptScan.findFirst({ where: { emailId: { startsWith: email.externalId } } }))) return { ids: [], ignored: "already received" };
  const files = email.attachments.filter((a) => /^(image\/|application\/pdf)/i.test(a.contentType) || /\.(jpe?g|png|heic|webp|pdf)$/i.test(a.name));
  if (!files.length) return { ids: [], ignored: "no invoice attached" };
  const fromAddr = (email.from.match(/<([^>]+)>/)?.[1] ?? email.from).trim().toLowerCase();
  const staff = await prisma.user.findUnique({ where: { email: fromAddr }, select: { id: true, name: true } });
  const admin = staff ?? (await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }));
  if (!admin) return { ids: [], ignored: "no users yet" };
  const pdfs = files.filter((f) => /pdf/i.test(f.contentType) || /\.pdf$/i.test(f.name));
  const groups = pdfs.length ? pdfs.map((f) => [f]) : [files.slice(0, 6)];
  const scans: string[] = [];
  for (const [i, g] of groups.entries()) {
    try {
      scans.push(
        await saveReceiptFiles(
          g.map((f) => ({ bytes: new Uint8Array(f.bytes), name: f.name })),
          { source: "EMAIL", employeeId: staff?.id ?? null, employee: staff?.name ?? email.from.slice(0, 120), subject: email.subject, message: messageText(email.bodyText ?? ""), emailId: `${email.externalId ?? "bill"}#${i}` },
          admin.id,
        ),
      );
    } catch (e) {
      console.error("bill attachment rejected", e);
    }
  }
  // read and match in the background so the email provider gets its answer right away
  for (const id of scans)
    void readReceipt(id)
      .then(() => openBill(id))
      .catch((e) => console.error("bill read failed", id, e));
  return { ids: scans };
}
