// Customer portal (§13): one secret link per job where the homeowner or GC sees their proposal, schedule,
// change orders, invoices and payments, and can sign and pay online. No costs, margins, or internal notes.
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { getCompany } from "@/lib/company-profile";
import { balanceDue } from "@/lib/billing/math";
import { emailConfigured, sendEmail } from "@/lib/email/send";

type Actor = { id: string; name: string; role: string };
export class PortalError extends Error {}
export const portalUrl = (token: string) =>
  `${process.env.APP_URL ?? ""}/portal/${token}`;

const STAGE_FOR_CUSTOMER: Record<string, string> = {
  LEAD: "Getting started",
  ESTIMATING: "Preparing your estimate",
  SUBMITTED: "Proposal sent",
  SOLD: "Contract signed — scheduling",
  SCHEDULED: "Scheduled",
  IN_PRODUCTION: "Work in progress",
  COMPLETE: "Work complete",
  INVOICED: "Final invoice sent",
  PAID: "Paid in full — thank you",
  CLOSED: "Closed",
  LOST: "Closed",
};

/** Creates (or keeps) the job's portal link; optionally emails it to the primary contact. */
export async function sharePortal(
  projectId: string,
  actor: Actor,
  opts: { email?: boolean } = {},
) {
  const co = await getCompany();
  if (actor.role === "VIEWER")
    throw new PortalError("Viewers can't share the portal.");
  const p = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      contacts: {
        where: { isPrimary: true },
        include: { contact: true },
        take: 1,
      },
    },
  });
  const token = p.portalToken ?? randomBytes(18).toString("base64url");
  if (!p.portalToken)
    await prisma.project.update({
      where: { id: projectId },
      data: { portalToken: token },
    });
  let emailed: string | null = null;
  const c = p.contacts[0]?.contact;
  if (opts.email && c?.email && emailConfigured()) {
    await sendEmail({
      to: c.email,
      subject: `${co.name} — your project page for ${p.name}`,
      text: `Hi ${c.firstName},\n\nEverything for your project is in one place — proposal, schedule, change orders, invoices and payments:\n${portalUrl(token)}\n\n${co.name} · ${co.phone}`,
    }).then(
      () => (emailed = c.email),
      (e) => console.error("portal email failed", e),
    );
  }
  await prisma.projectActivity.create({
    data: {
      projectId,
      userId: actor.id,
      kind: "portal",
      text: `${actor.name} shared the customer portal${emailed ? ` with ${emailed}` : ""}`,
    },
  });
  return { url: portalUrl(token), emailed };
}

export async function revokePortal(projectId: string, actor: Actor) {
  if (actor.role === "VIEWER")
    throw new PortalError("Viewers can't change the portal.");
  await prisma.project.update({
    where: { id: projectId },
    data: { portalToken: null },
  });
  await prisma.projectActivity.create({
    data: {
      projectId,
      userId: actor.id,
      kind: "portal",
      text: `${actor.name} turned off the customer portal link`,
    },
  });
}

/** Everything the customer may see, or null for an unknown/revoked link. */
export async function getPortal(token: string, now = new Date()) {
  if (!token) return null;
  const p = await prisma.project.findFirst({ where: { portalToken: token } });
  if (!p) return null;
  const [proposals, events, cos, invoices] = await Promise.all([
    prisma.proposal.findMany({
      where: { projectId: p.id, status: { notIn: ["DRAFT", "VOID"] } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.scheduleEvent.findMany({
      where: {
        projectId: p.id,
        status: { not: "CANCELLED" },
        endDate: { gte: new Date(now.getTime() - 60 * 86_400_000) },
      },
      orderBy: { startDate: "asc" },
    }),
    prisma.changeOrder.findMany({
      where: { projectId: p.id, sentAt: { not: null } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.invoice.findMany({
      where: { projectId: p.id, status: { notIn: ["DRAFT"] } },
      include: { payments: { orderBy: { date: "asc" } } },
      orderBy: { issueDate: "asc" },
    }),
  ]);
  return {
    project: {
      name: p.name,
      address: p.address,
      stage: STAGE_FOR_CUSTOMER[p.status] ?? p.status,
      contractAmount: p.contractAmount,
    },
    proposals: proposals.map((x) => ({
      number: x.number,
      title: x.title,
      status: x.status,
      price: x.acceptedTotal ?? x.basePrice,
      token: x.token,
      signedAt: x.signedAt,
    })),
    schedule: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      title: e.title,
      start: e.startDate,
      end: e.endDate,
      confirmed: e.status === "CONFIRMED" || e.status === "DONE",
      done: e.status === "DONE",
    })),
    changeOrders: cos.map((c) => ({
      number: c.number,
      description: c.description,
      amount: c.amount,
      status: c.status,
      token: c.token,
      signedAt: c.signedAt,
    })),
    invoices: invoices.map((i) => ({
      number: i.number,
      kind: i.kind,
      status: i.status,
      amountDue: i.amountDue,
      balance: i.status === "VOID" ? 0 : balanceDue(i),
      dueDate: i.dueDate,
      token: i.token,
      payments: i.payments.map((x) => ({ date: x.date, amount: x.amount })),
    })),
  };
}
