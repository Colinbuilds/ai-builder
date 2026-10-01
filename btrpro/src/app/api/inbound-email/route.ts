import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { ingestEmail, jobTokensFromAddresses, parseInboundPayload } from "@/lib/comms/email";
import { summarizeEmail } from "@/lib/comms/summaries";
import { aiConfigured } from "@/lib/ai/claude";
import { isReceiptsAddress, receiptsFromEmail } from "@/lib/receipts/inbox";
import { billsFromEmail, isBillsAddress } from "@/lib/bills/inbox";

// Inbound email webhook (Postmark JSON or generic JSON). Mail sent or CC'd to
// job-<token>@<INBOUND_EMAIL_DOMAIN> lands on that job; receipts@<INBOUND_EMAIL_DOMAIN> goes to the receipt reader. Auth: ?secret= or x-webhook-secret header.
function authorized(req: Request) {
  const expected = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
  if (!expected) return false;
  const got = req.headers.get("x-webhook-secret") ?? new URL(req.url).searchParams.get("secret") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "expected JSON" }, { status: 400 });
  }
  const { recipients, email } = parseInboundPayload(payload);
  // receipts@… → the receipt reader (only from BTR staff or crew emails)
  let receipts: { ids: string[]; ignored?: string } | null = null;
  if (isReceiptsAddress(recipients)) {
    receipts = await receiptsFromEmail(email);
    if (receipts.ignored) console.warn("receipt email ignored:", receipts.ignored);
  }
  // bills@… → supplier bills (accounts payable)
  let bills: { ids: string[]; ignored?: string } | null = null;
  if (isBillsAddress(recipients)) {
    bills = await billsFromEmail(email);
    if (bills.ignored) console.warn("bill email ignored:", bills.ignored);
  }
  const tokens = jobTokensFromAddresses(recipients);
  const projects = tokens.length ? await prisma.project.findMany({ where: { emailToken: { in: tokens } } }) : [];
  const stored: string[] = [];
  for (const p of projects) {
    try {
      const e = await ingestEmail(p.id, "FORWARDED", email, null);
      if (e) stored.push(e.id);
    } catch (err) {
      console.error("inbound email rejected", p.id, err);
    }
  }
  if (aiConfigured())
    await Promise.allSettled(stored.map((id) => summarizeEmail(id))).then((r) =>
      r.filter((x) => x.status === "rejected").forEach((x) => console.error("email summary failed", (x as PromiseRejectedResult).reason)),
    );
  // Always 200 for well-formed requests so the provider doesn't retry mail that matched no job.
  return NextResponse.json({ matchedJobs: projects.length, stored: stored.length, ...(receipts ? { receipts: receipts.ids.length } : {}), ...(bills ? { bills: bills.ids.length } : {}) });
}
