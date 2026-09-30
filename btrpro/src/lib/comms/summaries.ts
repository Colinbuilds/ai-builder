// AI summaries of job email and the "Catch me up" brief (BUILD_PROMPT §11).
import { z } from "zod";
import { prisma } from "@/lib/db";
import { aiParse, aiText } from "@/lib/ai/claude";
import { INTAKE_BY_KEY } from "@/lib/projects/intake";
import { computeReadiness } from "@/lib/projects/readiness";
import { loadReadinessInput } from "@/lib/projects/service";
import { STAGE_LABEL } from "@/lib/projects/workflow";

const fmt = (d: Date) => d.toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" });

const EmailSummary = z.object({
  summary: z.string().describe("2-3 sentences: who wrote, what they said or asked for"),
  asks: z.array(z.string()).describe("Things the sender asked BTR to do or answer; empty if none"),
  statedFigures: z
    .array(z.string())
    .describe("Every date, price, quantity, or measurement in the email, quoted with what it refers to; empty if none"),
  needsReply: z.boolean(),
});

const EMAIL_TASK = `Summarize one email attached to a BTR job for the estimating team.
Use only the email text. Don't add facts, prices, or dates that aren't in it.
Figures in an email are what the sender stated, not verified numbers; quote them as written.`;

export async function summarizeEmail(emailId: string) {
  const e = await prisma.jobEmail.findUniqueOrThrow({ where: { id: emailId }, include: { attachments: true } });
  const { data } = await aiParse({
    task: EMAIL_TASK,
    schema: EmailSummary,
    effort: "low",
    maxTokens: 4000,
    messages: [
      {
        role: "user",
        content: `From: ${e.fromAddr}\nTo: ${e.toAddrs ?? ""}\nDate: ${fmt(e.sentAt)}\nSubject: ${e.subject}\nAttachments: ${
          e.attachments.map((a) => a.fileName).join(", ") || "none"
        }\n\n${e.bodyText}`,
      },
    ],
  });
  const sender = e.fromAddr.replace(/\s*<.*>/, "");
  const lines = [data.summary.trim()];
  if (data.asks.length) lines.push(`Asks: ${data.asks.join("; ")}`);
  if (data.statedFigures.length) lines.push(`Stated by ${sender} (not verified): ${data.statedFigures.join("; ")}`);
  if (data.needsReply) lines.push("Needs a reply.");
  const summary = lines.join("\n");
  await prisma.jobEmail.update({ where: { id: emailId }, data: { summary } });
  return summary;
}

const CATCH_UP_TASK = `Write a catch-up brief so a BTR teammate can get up to speed on this job in under a minute.
Use only the job record in the user message. Never invent measurements, prices, quantities, dates, or decisions.
Any number that came from an email or chat is what that person said, not a verified figure: attribute it ("per <name>, <date>").
Format, using these headings exactly and short bullet points under each:
## Where it stands
## What happened
## Decisions made
## Waiting on / open questions
## Numbers mentioned
Write "None." under a heading with nothing to report. Field language, no filler.`;

export async function buildJobRecord(projectId: string, since: Date | null) {
  const p = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      clientCompany: true,
      intake: true,
      contacts: { include: { contact: { include: { company: true } } } },
      openItems: { where: { resolved: false } },
    },
  });
  const range = since ? { gt: since } : undefined;
  const [messages, emails, activity, readiness] = await Promise.all([
    prisma.jobMessage.findMany({
      where: { projectId, ...(range ? { createdAt: range } : {}) },
      include: { author: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.jobEmail.findMany({ where: { projectId, ...(range ? { sentAt: range } : {}) }, orderBy: { sentAt: "asc" } }),
    prisma.projectActivity.findMany({
      where: { projectId, kind: { not: "email" }, ...(range ? { createdAt: range } : {}) },
      orderBy: { createdAt: "asc" },
    }),
    loadReadinessInput(projectId).then(computeReadiness),
  ]);
  const missing = p.intake.filter((f) => f.status === "MISSING").map((f) => INTAKE_BY_KEY.get(f.key)?.label ?? f.key);
  const assumed = p.intake
    .filter((f) => f.status === "ASSUMED")
    .map((f) => `${INTAKE_BY_KEY.get(f.key)?.label ?? f.key} = ${f.value} (assumed: ${f.note})`);

  const lines: string[] = [
    `JOB: ${p.name} (${p.market === "RESIDENTIAL" ? "residential" : "commercial"})`,
    `Stage: ${STAGE_LABEL[p.status]}. Readiness: ${readiness.readiness}.`,
    p.address && `Address: ${p.address}`,
    p.clientCompany && `Client: ${p.clientCompany.name}`,
    p.bidDueDate && `Bid due: ${p.bidDueDate.toISOString().slice(0, 10)}`,
    p.isPublic && `Public job${p.isTaxExempt ? `, tax-exempt, Form 17 ${p.form17Status}` : ""}`,
    p.isInsuranceClaim && `Insurance claim: ${[p.insuranceCarrier, p.claimNumber && `#${p.claimNumber}`, p.adjusterName && `adjuster ${p.adjusterName}`].filter(Boolean).join(", ")}`,
    `Contacts: ${p.contacts.map((c) => `${c.contact.firstName} ${c.contact.lastName} (${c.role.toLowerCase()}${c.contact.company ? `, ${c.contact.company.name}` : ""})`).join("; ") || "none"}`,
    `Missing intake: ${missing.join(", ") || "none"}`,
    assumed.length ? `Assumptions: ${assumed.join("; ")}` : null,
    `Readiness blockers: ${readiness.blockers.map((b) => b.message).join("; ") || "none"}`,
    `Open items: ${p.openItems.map((o) => o.text).join("; ") || "none"}`,
    "",
    since ? `EVERYTHING BELOW IS SINCE ${fmt(since)}.` : "FULL HISTORY BELOW.",
    "",
    "ACTIVITY LOG:",
    ...activity.map((a) => `- ${fmt(a.createdAt)}: ${a.text}`),
    "",
    "TEAM CHAT:",
    ...messages.map((m) => `- ${fmt(m.createdAt)} ${m.author.name}: ${m.body}`),
    "",
    "EMAILS:",
    ...emails.map((e) => `--- ${fmt(e.sentAt)} from ${e.fromAddr}, subject "${e.subject}"\n${e.bodyText}`),
  ].filter((l): l is string => l !== null && l !== false && l !== undefined);
  return { text: lines.join("\n"), counts: { messages: messages.length, emails: emails.length, activity: activity.length } };
}

export async function catchUp(projectId: string, user: { id: string }, mode: "since_last" | "all") {
  const view = await prisma.projectView.findUnique({ where: { projectId_userId: { projectId, userId: user.id } } });
  const since = mode === "since_last" ? (view?.caughtUpAt ?? null) : null;
  const record = await buildJobRecord(projectId, since);
  const now = new Date();
  let content: string;
  if (since && record.counts.messages + record.counts.emails + record.counts.activity === 0) {
    content = `Nothing new since ${fmt(since)}.`;
  } else {
    ({ text: content } = await aiText({ task: CATCH_UP_TASK, messages: [{ role: "user", content: record.text }], effort: "medium" }));
  }
  const summary = await prisma.jobSummary.create({
    data: { projectId, kind: "CATCH_UP", content, coversFrom: since, coversTo: now, createdById: user.id },
  });
  await prisma.projectView.upsert({
    where: { projectId_userId: { projectId, userId: user.id } },
    update: { caughtUpAt: now },
    create: { projectId, userId: user.id, caughtUpAt: now },
  });
  return summary;
}
