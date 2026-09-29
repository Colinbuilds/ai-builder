import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import { findMentions, postMessage, unreadCounts, markChatRead } from "@/lib/comms/chat";
import { defaultMailQuery, htmlToText, ingestEmail, jobTokensFromAddresses, parseInboundPayload } from "@/lib/comms/email";
import { parseGmailMessage, parseGraphMessage } from "@/lib/comms/mailbox";
import { catchUp, summarizeEmail } from "@/lib/comms/summaries";
import { setAiClientForTests } from "@/lib/ai/claude";
import { decrypt, encrypt } from "@/lib/crypto";
import { POST as inbound } from "@/app/api/inbound-email/route";

process.env.UPLOAD_DIR = "prisma/test-uploads";
process.env.INBOUND_EMAIL_WEBHOOK_SECRET = "TEST_ONLY_secret";
process.env.AUTH_SECRET ??= "TEST_ONLY_auth_secret_value_32_chars!!";
afterAll(() => prisma.$disconnect());

// Fake AI client: records requests, returns canned answers. No network, no cost.
const calls: { kind: string; body: Record<string, unknown> }[] = [];
const fake = {
  beta: {
    messages: {
      create: async (body: Record<string, unknown>) => {
        calls.push({ kind: "create", body });
        return { stop_reason: "end_turn", model: "fake", content: [{ type: "text", text: "## Where it stands\n- TEST_ONLY brief" }] };
      },
      parse: async (body: Record<string, unknown>) => {
        calls.push({ kind: "parse", body });
        return {
          stop_reason: "end_turn",
          model: "fake",
          parsed_output: { summary: "GC sent addendum 2.", asks: ["Confirm bid by Friday"], statedFigures: ["22,400 SF roof area"], needsReply: true },
        };
      },
    },
  },
} as never;
beforeEach(() => {
  calls.length = 0;
  setAiClientForTests(fake);
});

const actor = async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  return { id: u.id, name: u.name };
};
const newJob = async (name: string) =>
  createProject({ name, market: "COMMERCIAL", scopes: ["LOW_SLOPE"], isPublic: false, isTaxExempt: false, address: "4401 S 72nd St, Omaha NE" }, await actor());

describe("chat", () => {
  it("finds @mentions by first name, full name, or email, not partial words", () => {
    const users = [
      { id: "a", name: "Trevin Smith", email: "trevin@btrcontracting.com" },
      { id: "b", name: "Colin Jones", email: "colin@btr.test" },
    ];
    expect(findMentions("@trevin can you call the GC?", users)).toEqual(["a"]);
    expect(findMentions("ping @Colin Jones and @trevin@btrcontracting.com", users).sort()).toEqual(["a", "b"]);
    expect(findMentions("email@colinx.com @colinx", users)).toEqual([]);
  });

  it("counts unread messages from others and flags mentions", async () => {
    const a = await actor();
    const other = await prisma.user.create({ data: { name: "TEST_ONLY Estimator", email: "est@test.local", passwordHash: "x", role: "ESTIMATOR" } });
    const p = await newJob("TEST_ONLY Chat job");
    await markChatRead(p.id, a.id);
    await postMessage(p.id, other.id, "Deck is 22 ga B deck per S-201");
    await postMessage(p.id, other.id, `@${a.name} need the tear-off count`);
    expect((await unreadCounts(a.id, [p.id]))[p.id]).toEqual({ unread: 2, mentioned: true });
    expect((await unreadCounts(other.id, [p.id]))[p.id]).toBeUndefined(); // own messages aren't unread
    await markChatRead(p.id, a.id);
    expect((await unreadCounts(a.id, [p.id]))[p.id]).toBeUndefined();
  });
});

describe("inbound email", () => {
  const postmark = (to: string) => ({
    FromFull: { Email: "pm@gc.test", Name: "TEST_ONLY GC PM" },
    From: "pm@gc.test",
    ToFull: [{ Email: to }],
    Subject: "Addendum 2",
    TextBody: "Roof area revised to 22,400 SF per A-501. Bids due Friday.",
    Date: "Tue, 29 Sep 2026 10:15:00 -0500",
    MessageID: "pm-1",
    Headers: [{ Name: "Message-ID", Value: "<TEST_ONLY-1@gc.test>" }],
    Attachments: [{ Name: "addendum2.pdf", ContentType: "application/pdf", Content: Buffer.from("%PDF-1.4 TEST_ONLY").toString("base64") }],
  });

  it("parses Postmark and generic payloads and finds job tokens", () => {
    const pm = parseInboundPayload(postmark("job-abc123@jobs.test"));
    expect(pm.email).toMatchObject({ externalId: "<TEST_ONLY-1@gc.test>", from: "TEST_ONLY GC PM <pm@gc.test>", subject: "Addendum 2" });
    expect(pm.email.attachments[0].name).toBe("addendum2.pdf");
    expect(jobTokensFromAddresses(pm.recipients)).toEqual(["abc123"]);
    const g = parseInboundPayload({ from: "a@b.test", to: ["x@y.test", "Job-XYZ9@jobs.test"], subject: "s", html: "<p>Hi&nbsp;there</p><br>ok" });
    expect(jobTokensFromAddresses(g.recipients)).toEqual(["xyz9"]);
    expect(g.email.bodyText).toMatch(/^Hi there\n+ok$/);
  });

  it("webhook rejects a bad secret, stores the email once, keeps attachments, and summarizes", async () => {
    const p = await newJob("TEST_ONLY Inbound job");
    const to = `job-${p.emailToken}@jobs.test`;
    const req = (secret: string) =>
      new Request(`http://x/api/inbound-email?secret=${secret}`, { method: "POST", body: JSON.stringify(postmark(to)) });
    expect((await inbound(req("wrong"))).status).toBe(401);
    expect(await (await inbound(req("TEST_ONLY_secret"))).json()).toEqual({ matchedJobs: 1, stored: 1 });
    expect(await (await inbound(req("TEST_ONLY_secret"))).json()).toEqual({ matchedJobs: 1, stored: 0 }); // duplicate
    const e = await prisma.jobEmail.findFirstOrThrow({ where: { projectId: p.id }, include: { attachments: true } });
    expect(e.attachments.map((a) => a.fileName)).toEqual(["addendum2.pdf"]);
    expect(e.summary).toContain("Stated by TEST_ONLY GC PM (not verified): 22,400 SF roof area");
    // The email summary call used CLAUDE.md as the system prompt and the fallback beta.
    const body = calls.find((c) => c.kind === "parse")!.body as { system: { text: string }[]; betas: string[]; fallbacks: string };
    expect(body.system[0].text).toContain("BTR Contracting");
    expect(body.betas).toContain("server-side-fallback-2026-07-01");
    expect(body.fallbacks).toBe("default");
  });
});

describe("catch me up", () => {
  it("builds from the job record, stores the summary, and says 'nothing new' when nothing changed", async () => {
    const a = await actor();
    const p = await newJob("TEST_ONLY Catch-up job");
    await postMessage(p.id, a.id, "Walked the roof, 2 layers of BUR");
    await ingestEmail(p.id, "MANUAL", { externalId: null, threadId: null, from: "owner@test.local", to: null, subject: "Access", sentAt: new Date(), bodyText: "Gate code 4411", attachments: [] }, a.id);
    const s1 = await catchUp(p.id, a, "since_last");
    expect(s1.content).toContain("TEST_ONLY brief");
    const sent = (calls.find((c) => c.kind === "create")!.body as { messages: { content: string }[] }).messages[0].content;
    expect(sent).toContain("Walked the roof, 2 layers of BUR");
    expect(sent).toContain("Gate code 4411");
    expect(sent).toContain("Missing intake:");
    calls.length = 0;
    const s2 = await catchUp(p.id, a, "since_last");
    expect(s2.content).toMatch(/^Nothing new since/);
    expect(calls).toHaveLength(0);
  });

  it("surfaces a refusal as an error without saving", async () => {
    setAiClientForTests({
      beta: { messages: { create: async () => ({ stop_reason: "refusal", stop_details: { category: null }, content: [] }) } },
    } as never);
    const a = await actor();
    const p = await newJob("TEST_ONLY Refusal job");
    const before = await prisma.jobSummary.count();
    await expect(catchUp(p.id, a, "all")).rejects.toThrow(/declined/);
    expect(await prisma.jobSummary.count()).toBe(before);
  });
});

describe("mailbox parsing", () => {
  it("parses a Gmail API message", () => {
    const b64 = (s: string) => Buffer.from(s).toString("base64url");
    const m = parseGmailMessage({
      id: "g1",
      threadId: "t1",
      payload: {
        headers: [
          { name: "From", value: "Adjuster <adj@carrier.test>" },
          { name: "Subject", value: "Claim TEST-1 approved" },
          { name: "Message-ID", value: "<g1@test>" },
          { name: "Date", value: "Mon, 28 Sep 2026 09:00:00 -0500" },
        ],
        parts: [
          { mimeType: "text/plain", body: { data: b64("Approved for full replacement.") } },
          { mimeType: "application/pdf", filename: "estimate.pdf", body: { attachmentId: "att1" } },
        ],
      },
    });
    expect(m).toMatchObject({ externalId: "<g1@test>", threadId: "t1", from: "Adjuster <adj@carrier.test>", bodyText: "Approved for full replacement." });
    expect(m.attachmentRefs).toEqual([{ id: "att1", name: "estimate.pdf", contentType: "application/pdf" }]);
  });

  it("parses a Microsoft Graph message", () => {
    const m = parseGraphMessage({
      id: "m1",
      internetMessageId: "<m1@test>",
      conversationId: "c1",
      subject: "Submittal review",
      from: { emailAddress: { name: "Architect", address: "arch@test.local" } },
      toRecipients: [{ emailAddress: { address: "est@btr.test" } }],
      sentDateTime: "2026-09-28T15:00:00Z",
      body: { contentType: "html", content: "<p>Approved as noted.</p>" },
    });
    expect(m).toMatchObject({ externalId: "<m1@test>", from: "Architect <arch@test.local>", bodyText: "Approved as noted.", to: "est@btr.test" });
  });

  it("builds a default search from claim #, AccuLynx #, and street address", () => {
    expect(defaultMailQuery({ name: "Johnson hail", claimNumber: "CLM-9", address: "123 Elm St, Omaha", acculynxJobNumber: null })).toBe('"CLM-9" OR "123 Elm St"');
    expect(defaultMailQuery({ name: "Fontenelle Hills — Bldg C", claimNumber: null, address: null, acculynxJobNumber: null })).toBe('"Fontenelle Hills"');
  });

  it("encrypts mailbox tokens at rest", () => {
    const sealed = encrypt("ya29.TEST_ONLY");
    expect(sealed).not.toContain("TEST_ONLY");
    expect(decrypt(sealed)).toBe("ya29.TEST_ONLY");
  });
  it("strips html", () => expect(htmlToText("<ul><li>a</li><li>b</li></ul>")).toBe("• a\n• b"));
});
