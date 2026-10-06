// TEST_ONLY console: operator sign-in, demo requests, buildouts and health checks.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { signSession, verifySession } from "@/lib/session";
import { checkLogin } from "@/lib/auth";
import { LeadError, submitLead } from "@/lib/leads";
import { BuildoutError, createBuildout, runChecks, summary, updateBuildout } from "@/lib/buildouts";
import { checkBuildout } from "@/lib/health";
import { monthlyFor } from "@/lib/pricing";

beforeEach(async () => {
  await prisma.buildout.deleteMany();
  await prisma.lead.deleteMany();
});

describe("operator sign-in", () => {
  it("accepts only the env login", () => {
    expect(checkLogin("TEST-ONLY-op@example.com ", "TEST_ONLY-password-123")).toBe(true);
    expect(checkLogin("test-only-op@example.com", "wrong-password-xx")).toBe(false);
    expect(checkLogin("someone@example.com", "TEST_ONLY-password-123")).toBe(false);
  });

  it("session cookies verify, and tampered or expired ones don't", async () => {
    const t = await signSession("test-only-op@example.com");
    expect(await verifySession(t)).toEqual({ email: "test-only-op@example.com" });
    const [body, sig] = t.split(".");
    expect(await verifySession(`${body}x.${sig}`)).toBeNull();
    expect(await verifySession(`${body}.${sig.slice(0, -2)}AA`)).toBeNull();
    expect(await verifySession(t, Date.now() + 15 * 86_400_000)).toBeNull();
    expect(await verifySession(undefined)).toBeNull();
  });
});

describe("demo requests", () => {
  const lead = { name: "TEST_ONLY Dana", company: "TEST_ONLY Cool Air", email: "Test-Only@Example.com", trade: "hvac", users: "6", message: "TEST_ONLY" };

  it("saves a valid request", async () => {
    const l = await submitLead(lead);
    expect(l).toMatchObject({ email: "test-only@example.com", trade: "hvac", users: 6, status: "NEW" });
  });

  it("rejects bad input, bots and floods", async () => {
    await expect(submitLead({ ...lead, email: "nope", trade: "astronaut" })).rejects.toThrow(/valid email.*trade/);
    await expect(submitLead({ ...lead, website: "spam.example" })).rejects.toThrow(LeadError);
    for (let i = 0; i < 5; i++) await submitLead(lead);
    await expect(submitLead(lead)).rejects.toThrow(/already have your request/);
  });
});

describe("buildouts", () => {
  const acme = { company: "TEST_ONLY Acme Electric", trade: "electrical", status: "LIVE", users: "5", url: "https://test-only-acme.example/", internalUrl: "", customMonthly: "", setupFee: "$750", ownerEmail: "", notes: "" };

  it("creates from the form, marks the lead won, and feeds the money summary", async () => {
    const l = await submitLead({ name: "TEST_ONLY Pat", company: "TEST_ONLY Acme Electric", email: "test-only-pat@example.com", trade: "electrical" });
    const b = await createBuildout({ ...acme, leadId: l.id });
    expect(b).toMatchObject({ url: "https://test-only-acme.example", setupFee: 750, setupPaid: false, protected: false, users: 5 });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: l.id } })).status).toBe("WON");
    await createBuildout({ ...acme, company: "TEST_ONLY Big Roofing Co", trade: "roofing", users: "30", customMonthly: "1500", protected: "on" });
    await createBuildout({ ...acme, company: "TEST_ONLY Paused Co", status: "PAUSED" });
    const s = await summary();
    expect(s).toMatchObject({ live: 2, mrr: Math.round((monthlyFor(5)! + 1500) * 100) / 100, setupOwed: 2250, newLeads: 0 });
  });

  it("refuses bad input", async () => {
    await expect(createBuildout({ ...acme, url: "acme.com" })).rejects.toThrow(/http/);
    await expect(createBuildout({ ...acme, users: "30" })).rejects.toThrow(/agreed monthly rate/);
    await expect(createBuildout({ ...acme, customMonthly: "-5" })).rejects.toThrow(BuildoutError);
    const b = await createBuildout(acme);
    await expect(updateBuildout(b.id, { ...acme, company: "" })).rejects.toThrow(/Company/);
  });

  it("health checks prefer the private address and record up / down", async () => {
    const seen: string[] = [];
    const up = (async (u: string) => (seen.push(u), new Response("ok", { status: 200 }))) as unknown as typeof fetch;
    expect(await checkBuildout({ url: "https://a.example", internalUrl: "http://a.railway.internal:3000/" }, up)).toMatchObject({ ok: true, error: null });
    expect(seen).toEqual(["http://a.railway.internal:3000/login"]);
    expect(await checkBuildout({ url: null, internalUrl: null })).toEqual({ ok: false, ms: null, error: "No address set." });

    const b = await createBuildout(acme);
    const down = (async () => new Response("x", { status: 502 })) as unknown as typeof fetch;
    await runChecks([b.id], down);
    expect(await prisma.buildout.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ lastCheckOk: false, lastCheckError: "HTTP 502" });
    expect((await summary()).down).toBe(1);
  });
});
