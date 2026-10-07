// Builder start sheets by email. Forward the builder's email (or have the builder send it) to houses@<INBOUND_EMAIL_DOMAIN>
// and every option / start sheet PDF on it is read and waits on Add a builder house. Start sheets that arrive at
// receipts@ by mistake are routed here too. Accepted from staff, crews, and the email domains of builder accounts.
import { prisma } from "@/lib/db";
import type { NormalizedEmail } from "@/lib/comms/email";
import { pdfToText } from "@/lib/sheets/extract";
import { looksLikeStartSheet, readStartSheet } from "./starts";

export const HOUSES_LOCAL = () => (process.env.HOUSES_INBOX ?? "houses").toLowerCase();
export const housesAddress = () => (process.env.INBOUND_EMAIL_DOMAIN ? `${HOUSES_LOCAL()}@${process.env.INBOUND_EMAIL_DOMAIN}` : null);
export const isHousesAddress = (addresses: string[]) => addresses.some((a) => new RegExp(`(^|<|\\s)${HOUSES_LOCAL()}@`, "i").test(a.trim()));

const senderEmail = (from: string) => (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
const isPdf = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
const FREE_MAIL = /@(gmail|yahoo|outlook|hotmail|icloud|aol|live|msn)\./i;

/** Who sent it, if they're allowed to: staff, a crew, or someone at a builder's email domain. */
async function sender(from: string) {
  const addr = senderEmail(from);
  const user = await prisma.user.findUnique({ where: { email: addr }, select: { id: true, name: true, role: true } });
  if (user) return user.role === "VIEWER" ? null : { id: user.id, name: user.name, role: user.role };
  const crew = await prisma.crew.findFirst({ where: { active: true, OR: [{ loginEmail: addr }, { email: addr }] }, select: { name: true } });
  if (crew) return { id: "email", name: crew.name, role: "OFFICE" };
  const domain = addr.split("@")[1];
  if (domain && !FREE_MAIL.test(addr)) {
    const builder = await prisma.company.findFirst({ where: { type: "BUILDER", OR: [{ email: { endsWith: `@${domain}` } }, { contacts: { some: { email: { endsWith: `@${domain}` } } } }] }, select: { name: true } });
    if (builder) return { id: "email", name: `${builder.name} (${addr})`, role: "OFFICE" };
  }
  return null;
}

/** Reads every start-sheet PDF on the email. `onlyStartSheets` skips other PDFs silently (for receipts@). */
export async function startsFromEmail(email: NormalizedEmail, opts: { onlyStartSheets?: boolean } = {}): Promise<{ ids: string[]; consumed: number[]; ignored?: string }> {
  const who = await sender(email.from);
  if (!who) return { ids: [], consumed: [], ignored: `sender ${senderEmail(email.from)} isn't staff, a crew, or at a builder's email domain` };
  const ids: string[] = [];
  const consumed: number[] = [];
  for (const [i, a] of email.attachments.entries()) {
    const bytes = new Uint8Array(a.bytes);
    if (!isPdf(bytes)) continue;
    const text = await pdfToText(bytes).catch(() => "");
    if (opts.onlyStartSheets && !looksLikeStartSheet(text)) continue;
    try {
      const r = await readStartSheet({ bytes, name: a.name || "start.pdf" }, { id: who.id, name: who.name, role: who.role }, text || undefined);
      ids.push(r.start.id);
      consumed.push(i);
    } catch (e) {
      console.warn("start sheet on email not read:", a.name, e instanceof Error ? e.message : e);
    }
  }
  return ids.length ? { ids, consumed } : { ids, consumed, ignored: "no builder start sheet PDF on it" };
}
