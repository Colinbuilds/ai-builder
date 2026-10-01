import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { nextInSequence } from "@/lib/numbering";
import { totalsFor } from "@/lib/estimates/service";
import { getSettings } from "@/lib/settings";
import { saveUpload } from "@/lib/storage";
import { emailConfigured, sendEmail } from "@/lib/email/send";
import { BTR } from "@/lib/company";
import { acceptedTotal, proposalPrice, type Alternate } from "./price";
import { proposalPdf } from "./pdf";
import { freezeBaseline } from "@/lib/costing/service";

type Actor = { id: string; name: string };
export class ProposalError extends Error {}

async function nextNumber() {
  const year = new Date().getFullYear();
  const prefix = `P-${year}-`;
  const used = await prisma.proposal.findMany({
    where: { number: { startsWith: prefix } },
    select: { number: true },
  });
  return nextInSequence(
    prefix,
    used.map((x) => x.number),
  );
}

export async function createProposal(
  estimateId: string,
  input: {
    markupPct: number | null;
    priceOverride?: number | null;
    priceNote?: string | null;
    alternates: Alternate[];
    acknowledgeNotReady?: boolean;
  },
  actor: Actor,
) {
  const e = await prisma.estimate.findUniqueOrThrow({
    where: { id: estimateId },
    include: {
      project: {
        include: {
          contacts: { where: { isPrimary: true }, include: { contact: true } },
          clientCompany: true,
        },
      },
      scopeItems: { orderBy: { sortOrder: "asc" } },
    },
  });
  const totals = await totalsFor(estimateId);
  if (totals.incomplete)
    throw new ProposalError(
      "The estimate is INCOMPLETE (some lines or labor have no number). Finish it before making a proposal.",
    );
  if (!e.scopeItems.some((x) => x.type === "WE_WILL"))
    throw new ProposalError(
      'Write the scope of work (at least one "We will" line) on the estimate first. A proposal without a scope is how change-order fights start.',
    );
  if (e.project.readiness === "NOT_READY" && !input.acknowledgeNotReady)
    throw new ProposalError(
      "The job is NOT READY FOR HARD BID. Check the box to confirm you're sending it anyway.",
    );
  const s = await getSettings();
  const markup = input.markupPct ?? s.markupPct;
  if (markup == null || !Number.isFinite(markup) || markup < 0)
    throw new ProposalError(
      "Enter a markup % (or set the company default under Settings → Company).",
    );
  if (!s.proposalTerms)
    throw new ProposalError(
      "Add your proposal terms under Settings → Company first.",
    );
  for (const a of input.alternates)
    if (!a.name.trim() || !Number.isFinite(a.price))
      throw new ProposalError("Each alternate needs a name and a price.");
  const price = proposalPrice({
    cost: totals.grandTotal,
    materials: totals.materials,
    taxExempt: e.project.isTaxExempt,
    taxPct: s.salesTaxPct,
    markupPct: markup,
  });
  const override = input.priceOverride ?? null;
  if (override != null && !input.priceNote?.trim())
    throw new ProposalError(
      "Say why the price differs from the calculated price.",
    );
  const contact = e.project.contacts[0]?.contact;
  const p = await prisma.proposal.create({
    data: {
      projectId: e.projectId,
      estimateId,
      number: await nextNumber(),
      title: e.project.name,
      token: randomBytes(24).toString("base64url"),
      costTotal: totals.grandTotal,
      taxPct: e.project.isTaxExempt ? null : s.salesTaxPct,
      taxAmount: price.taxAmount,
      markupPct: markup,
      basePrice: override ?? price.basePrice,
      priceNote:
        override != null
          ? `${input.priceNote!.trim()} (calculated ${price.basePrice.toFixed(2)})`
          : price.breakdown,
      alternates: input.alternates as unknown as Prisma.InputJsonValue,
      depositPct: s.depositPct,
      terms: [s.proposalTerms, s.warrantyText].filter(Boolean).join("\n\n"),
      scope: {
        weWill: e.scopeItems
          .filter((x) => x.type === "WE_WILL")
          .map((x) => x.text),
        weWillNot: e.scopeItems
          .filter((x) => x.type === "WE_WILL_NOT")
          .map((x) => x.text),
      },
      validUntil: s.proposalValidDays
        ? new Date(Date.now() + s.proposalValidDays * 86_400_000)
        : null,
      recipientName: contact
        ? `${contact.firstName} ${contact.lastName}`
        : (e.project.clientCompany?.name ?? null),
      recipientEmail: contact?.email ?? e.project.clientCompany?.email ?? null,
      createdById: actor.id,
    },
  });
  await prisma.projectActivity.create({
    data: {
      projectId: e.projectId,
      userId: actor.id,
      kind: "proposal",
      text: `${actor.name} created proposal ${p.number} from ${e.name}: $${p.basePrice.toFixed(2)}`,
    },
  });
  return p;
}

export const proposalUrl = (token: string) =>
  `${process.env.APP_URL ?? ""}/p/${token}`;

export async function sendProposal(
  id: string,
  to: { name: string | null; email: string | null },
  actor: Actor,
) {
  const p = await prisma.proposal.findUniqueOrThrow({ where: { id } });
  if (!["DRAFT", "SENT", "VIEWED"].includes(p.status))
    throw new ProposalError(`Proposal is ${p.status.toLowerCase()}.`);
  let emailed = false;
  if (to.email && emailConfigured()) {
    await sendEmail({
      to: to.email,
      subject: `${BTR.name} proposal ${p.number} — ${p.title}`,
      text: `Hi ${to.name ?? ""},\n\nYour proposal from ${BTR.name} is ready to review and sign:\n${proposalUrl(p.token)}\n\n${p.validUntil ? `It's valid until ${p.validUntil.toLocaleDateString("en-US")}.\n\n` : ""}Questions? Call ${BTR.phone} or reply to this email.\n\n${BTR.name}\n${BTR.address}`,
      replyTo: BTR.email,
    });
    emailed = true;
  }
  await prisma.proposal.update({
    where: { id },
    data: {
      status: p.status === "DRAFT" ? "SENT" : p.status,
      sentAt: p.sentAt ?? new Date(),
      recipientName: to.name,
      recipientEmail: to.email,
    },
  });
  await prisma.projectActivity.create({
    data: {
      projectId: p.projectId,
      userId: actor.id,
      kind: "proposal",
      text: `${actor.name} ${emailed ? `emailed proposal ${p.number} to ${to.email}` : `marked proposal ${p.number} sent (link shared)`}`,
    },
  });
  return { emailed, url: proposalUrl(p.token) };
}

export async function getByToken(token: string) {
  const p = await prisma.proposal.findUnique({ where: { token } });
  if (!p || p.status === "VOID" || p.status === "DRAFT") return null;
  return p;
}

/** Every open is counted; the rep hears about the first one, and again when they come back an hour or more later — the best time to call. */
export async function markViewed(token: string) {
  const p = await getByToken(token);
  if (!p) return;
  const now = new Date();
  const back = !!p.lastViewedAt && now.getTime() - p.lastViewedAt.getTime() >= 3_600_000;
  await prisma.proposal.update({
    where: { id: p.id },
    data: {
      viewedAt: p.viewedAt ?? now,
      lastViewedAt: now,
      viewCount: { increment: 1 },
      status: p.status === "SENT" ? "VIEWED" : p.status,
    },
  });
  if (!p.viewedAt || back)
    await prisma.projectActivity.create({
      data: {
        projectId: p.projectId,
        kind: "proposal",
        text: !p.viewedAt ? `Customer opened proposal ${p.number} — good time to call` : `Customer is looking at proposal ${p.number} again (${p.viewCount + 1} opens) — good time to call`,
      },
    });
}

const open = (p: { status: string; validUntil: Date | null }) => {
  if (!["SENT", "VIEWED"].includes(p.status))
    throw new ProposalError(`This proposal is ${p.status.toLowerCase()}.`);
  if (p.validUntil && p.validUntil < new Date())
    throw new ProposalError(
      "This proposal has expired. Contact BTR for an updated one.",
    );
};

export async function signProposal(
  token: string,
  input: {
    name: string;
    email: string;
    consent: boolean;
    selected: string[];
    signatureImage: string | null;
    ip: string | null;
    agent: string | null;
  },
) {
  const p = await getByToken(token);
  if (!p) throw new ProposalError("Proposal not found.");
  open(p);
  if (!input.consent)
    throw new ProposalError("Check the box to agree to sign electronically.");
  if (input.name.trim().length < 2)
    throw new ProposalError("Type your full name to sign.");
  if (!/^\S+@\S+\.\S+$/.test(input.email.trim()))
    throw new ProposalError("Enter a valid email.");
  if (
    input.signatureImage &&
    (!input.signatureImage.startsWith("data:image/png;base64,") ||
      input.signatureImage.length > 500_000)
  )
    throw new ProposalError("Signature image is invalid.");
  const alternates = (p.alternates as Alternate[] | null) ?? [];
  const selected = input.selected.filter((n) =>
    alternates.some((a) => a.name === n),
  );
  const total = acceptedTotal(p.basePrice, alternates, selected);
  const now = new Date();
  const signed = await prisma.proposal.update({
    where: { id: p.id },
    data: {
      status: "SIGNED",
      signedAt: now,
      signerName: input.name.trim(),
      signerEmail: input.email.trim().toLowerCase(),
      signerIp: input.ip,
      signerAgent: input.agent?.slice(0, 300) ?? null,
      signatureImage: input.signatureImage,
      selectedAlternates: selected,
      acceptedTotal: total,
    },
  });
  // Signed copy on the job.
  const pdf = await proposalPdf(signed);
  const fileUrl = await saveUpload(
    pdf,
    `${p.number}-signed.pdf`,
    `projects/${p.projectId}/proposals`,
  );
  const doc = await prisma.document.create({
    data: {
      projectId: p.projectId,
      type: "OTHER",
      fileName: `${p.number} signed proposal.pdf`,
      fileUrl,
      source: "UPLOAD",
      contentType: "application/pdf",
      sizeBytes: pdf.length,
    },
  });
  const final = await prisma.proposal.update({
    where: { id: p.id },
    data: { signedDocumentId: doc.id },
  });
  // Contract on the job; move to Sold if it isn't there yet.
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: p.projectId },
  });
  const early = ["LEAD", "ESTIMATING", "SUBMITTED"].includes(project.status);
  await prisma.project.update({
    where: { id: p.projectId },
    data: {
      contractAmount: total,
      contractSignedAt: now,
      ...(early ? { status: "SOLD", statusChangedAt: now } : {}),
    },
  });
  await prisma.projectActivity.create({
    data: {
      projectId: p.projectId,
      kind: "proposal",
      text: `${input.name.trim()} signed proposal ${p.number} for $${total.toFixed(2)}${selected.length ? ` (with ${selected.join(", ")})` : ""}${early ? `; job moved ${project.status} → SOLD` : ""}`,
    },
  });
  // Freeze the signed estimate as the job-cost baseline (§12) unless one was frozen already.
  if (!project.costBaseline)
    await freezeBaseline(
      p.projectId,
      p.estimateId,
      { id: null, name: `Signed proposal ${p.number}`, role: "SYSTEM" },
      null,
      selected,
    ).catch((e) =>
      prisma.projectActivity.create({
        data: {
          projectId: p.projectId,
          kind: "costing",
          text: `Cost baseline not frozen automatically: ${e instanceof Error ? e.message : e}`,
        },
      }),
    );
  await prisma.auditLog.create({
    data: {
      entity: "Proposal",
      entityId: p.id,
      action: "signed",
      after: {
        name: input.name,
        email: input.email,
        ip: input.ip,
        total,
        at: now.toISOString(),
      },
    },
  });
  if (emailConfigured())
    await sendEmail({
      to: input.email.trim(),
      subject: `Signed: ${BTR.name} proposal ${p.number}`,
      text: `Thank you, ${input.name.trim()}. Your signed proposal is attached for your records.\n\n${BTR.name} · ${BTR.phone}`,
      attachments: [
        {
          name: `${p.number}-signed.pdf`,
          contentType: "application/pdf",
          bytes: pdf,
        },
      ],
    }).catch((e) => console.error("signed copy email failed", e));
  return final;
}

export async function declineProposal(token: string, reason: string) {
  const p = await getByToken(token);
  if (!p) throw new ProposalError("Proposal not found.");
  open(p);
  await prisma.proposal.update({
    where: { id: p.id },
    data: {
      status: "DECLINED",
      declinedAt: new Date(),
      declineReason: reason.trim() || null,
    },
  });
  await prisma.projectActivity.create({
    data: {
      projectId: p.projectId,
      kind: "proposal",
      text: `Customer declined proposal ${p.number}${reason.trim() ? `: ${reason.trim()}` : ""}`,
    },
  });
}

export async function voidProposal(id: string, actor: Actor) {
  const p = await prisma.proposal.update({
    where: { id },
    data: { status: "VOID" },
  });
  await prisma.projectActivity.create({
    data: {
      projectId: p.projectId,
      userId: actor.id,
      kind: "proposal",
      text: `${actor.name} voided proposal ${p.number}`,
    },
  });
}
