// White-label foundation. The hard requirement: with no profile or rules saved, BTR's deployment behaves exactly
// as before (same company facts, same names, CLAUDE.md as the prompt, Nebraska rules). Then a TEST_ONLY company
// profile flows through. All rows written here are removed afterwards.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { BTR, SUPPLIER, accountWarning } from "@/lib/company";
import { DEFAULT_PROFILE, ProfileError, brandCss, companySync, exemptForm, getCompany, resetCompanyCacheForTests, resolveProfile, saveCompanyProfile } from "@/lib/company-profile";
import { regionFor } from "@/lib/region";
import { btrCompanyRules, buildSystemPrompt, estimatorSystemPrompt } from "@/lib/ai/prompt";
import { AiRefusalError, AiUnavailableError, aiErrorMessage, system } from "@/lib/ai/claude";
import { lienDeadline, riskDesk } from "@/lib/reports/risk";
import { checkStageChange } from "@/lib/projects/workflow";

const CLAUDE_MD = readFileSync(path.join(process.cwd(), "CLAUDE.md"), "utf8");
const admin = { id: "", name: "TEST_ONLY white-label" };

async function clear() {
  await prisma.companySetting.deleteMany({ where: { key: { in: ["companyProfile", "aiRules"] } } });
  resetCompanyCacheForTests();
}
beforeEach(clear);
afterEach(clear);
afterAll(clear);

describe("defaults: no profile saved = BTR exactly as today", () => {
  it("company facts and names are BTR's", async () => {
    const co = await getCompany();
    expect(co).toMatchObject({
      name: BTR.name,
      shortName: "BTR",
      productName: "BTRpro",
      assistantName: "BTRbot",
      address: BTR.address,
      phone: BTR.phone,
      email: BTR.email,
      proposalAddress: [...BTR.proposalAddress],
      officePhone: BTR.officePhone,
      abcAccount: BTR.abcAccount,
      ownAddresses: [...BTR.ownAddresses],
      supplier: { ...SUPPLIER },
      state: "NE",
      jurisdiction: "Omaha, NE",
      logo: null,
      brandColor: null,
      headerColor: null,
    });
    expect(companySync().name).toBe("BTR Contracting");
  });

  it("the AI system prompt is CLAUDE.md, byte for byte", async () => {
    expect(await estimatorSystemPrompt()).toBe(CLAUDE_MD);
    const blocks = await system("TASK: TEST_ONLY");
    expect(blocks[0].text).toBe(CLAUDE_MD);
    expect(blocks[1].text).toBe("TASK: TEST_ONLY");
  });

  it("AI messages still say BTRbot", () => {
    expect(new AiUnavailableError().message).toBe("BTRbot isn't turned on yet. Set ANTHROPIC_API_KEY on the server.");
    expect(aiErrorMessage(new AiRefusalError(null))).toBe("BTRbot declined this request. Nothing was saved.");
  });

  it("Nebraska rules: 120-day lien, Form 17, Omaha code editions", async () => {
    const { region } = await getCompany();
    expect(region.lien).toMatchObject({ days: 120, statute: "Neb. Rev. Stat. § 52-137" });
    expect(lienDeadline(new Date("2026-06-01T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-09-29");
    expect((await riskDesk()).lienRule).toMatchObject({ days: 120, stateName: "Nebraska", summary: "record within 120 days of last work, or the lien right is gone" });
    expect(exemptForm()).toMatchObject({ short: "Form 17", named: "Nebraska Form 17", title: "Nebraska Form 17 Purchasing Agent Appointment" });
    expect(region.codeNote).toBe("Omaha enforces the 2018 IBC and 2018 IRC, the 2018 IECC for commercial work");
  });

  it("messages that name the form are worded as before", () => {
    const r = checkStageChange({ from: "SOLD", to: "SCHEDULED", readiness: "BID_READY", form17Status: "PENDING", contractAmount: 1, contractSignedAt: new Date() });
    expect(r.ok ? [] : r.problems).toEqual(["PUB-01: Nebraska Form 17 must be executed with the owner before materials are purchased or the job is scheduled."]);
  });

  it("no brand CSS is injected and the price-sheet account warning is unchanged", () => {
    expect(brandCss(DEFAULT_PROFILE)).toBe("");
    expect(accountWarning("2182359-2")).toBe("Sheet is issued to account 2182359-2, not BTR's 2057372-2. Confirm pricing applies to BTR before bid use.");
    expect(accountWarning("2182359-2", DEFAULT_PROFILE)).toBe(accountWarning("2182359-2"));
    expect(accountWarning("2057372-2")).toBeNull();
  });

  it("BTR's editable rules start as CLAUDE.md's company sections, and saving them unchanged keeps CLAUDE.md", async () => {
    const rules = btrCompanyRules();
    expect(rules.startsWith("## 1. Company context")).toBe(true);
    for (const h of ["## 2. Role", "## 5. Price sheets", "## 6. Locked company takeoff rules", "## 10. Communication style"]) expect(rules).toContain(h);
    for (const h of ["## 3. Non-negotiable", "## 4. Project intake", "## 7. Takeoff workflow"]) expect(rules).not.toContain(h);
    // the Settings action blanks rules that equal the built-in text; a blank save keeps BTR on CLAUDE.md
    await saveCompanyProfile({ aiRules: "" }, null, {}, admin);
    expect(await estimatorSystemPrompt()).toBe(CLAUDE_MD);
    expect(await prisma.companySetting.count({ where: { key: { in: ["companyProfile", "aiRules"] } } })).toBe(0);
  });
});

describe("a TEST_ONLY white-label company", () => {
  const acme = {
    name: "TEST_ONLY Acme Exteriors",
    shortName: "Acme",
    productName: "AcmePro",
    assistantName: "AcmeBot",
    address: "1 TEST_ONLY Way, Des Moines, IA 50309",
    phone: "515-555-0100",
    email: "office@test-only.example",
    state: "ia",
    jurisdiction: "Des Moines, IA",
    brandColor: "#c0392b",
    headerColor: "#222222",
    abcAccount: "TEST_ONLY-1",
    proposalAddress: "1 TEST_ONLY Way\nDes Moines, IA 50309",
    supplierName: "TEST_ONLY Supply",
    aiRules: "- TEST_ONLY rule: waste 7% on everything.",
  };

  it("saves and flows into names, region, colors, warnings and the prompt", async () => {
    const co = await saveCompanyProfile(acme, null, {}, admin);
    expect(co).toMatchObject({ name: acme.name, shortName: "Acme", productName: "AcmePro", assistantName: "AcmeBot", state: "IA", proposalAddress: ["1 TEST_ONLY Way", "Des Moines, IA 50309"], officePhone: acme.phone });
    // BTR's facts never fill in for another company
    expect(co.supplier).toEqual({ name: "TEST_ONLY Supply", address: "", phone: "", surchargeNote: "" });
    expect(co.ownAddresses).toEqual([]);
    expect(companySync().assistantName).toBe("AcmeBot");
    expect(new AiUnavailableError().message).toMatch(/^AcmeBot isn't turned on/);

    // no Iowa rules on file: nothing is assumed
    expect(co.region).toMatchObject({ state: "IA", lien: null, exemptForm: null, codeNote: null });
    expect((await riskDesk()).lienRule).toBeNull();
    expect(checkStageChange({ from: "SOLD", to: "SCHEDULED", readiness: "BID_READY", form17Status: "PENDING", contractAmount: 1, contractSignedAt: new Date() })).toMatchObject({ ok: false });

    expect(brandCss(co)).toContain("--btr-blue:#c0392b");
    expect(brandCss(co)).toContain("--btr-black:#222222");
    expect(accountWarning("999", co)).toBe("Sheet is issued to account 999, not Acme's TEST_ONLY-1. Confirm pricing applies to Acme before bid use.");

    const prompt = await estimatorSystemPrompt();
    expect(prompt).not.toBe(CLAUDE_MD);
    expect(prompt).toContain("# AcmePro — TEST_ONLY Acme Exteriors");
    expect(prompt).toContain("You are AcmeBot");
    expect(prompt).toContain("- TEST_ONLY rule: waste 7% on everything.");
    expect(prompt).toContain("## 3. Non-negotiable accuracy rules");
    expect(prompt).not.toMatch(/\{\{\w+\}\}/);
    // none of BTR's own context, sheets or locked rules leak into another company's prompt
    for (const btr of ["BTR", "Omaha", "Nebraska", "Form 17", "ABC Supply", "Michael Poe", "Colin", "HardiePlank"]) expect(prompt).not.toContain(btr);
  });

  it("a state lien override applies, labeled as the company's setting", async () => {
    const co = await saveCompanyProfile({ ...acme, lienDays: "90" }, null, {}, admin);
    expect(co.region.lien).toMatchObject({ days: 90, statute: "company setting" });
    expect(regionFor("NE", { lienDays: 120 }).lien?.statute).toBe("Neb. Rev. Stat. § 52-137");
  });

  it("with no rules saved, another company gets the general rules and is told to ask for its standards", () => {
    const other = resolveProfile({ name: "TEST_ONLY Other Co" });
    // every company but BTR is on Joblight unless it renames the app
    expect(other).toMatchObject({ productName: "Joblight", assistantName: "Lumen" });
    const prompt = buildSystemPrompt(other, null);
    expect(prompt).toContain("# Joblight — TEST_ONLY Other Co");
    expect(prompt).toContain("You are Lumen");
    expect(prompt).toContain("No company estimating rules are saved yet");
    expect(prompt).not.toContain("Masonry exclusion");
  });

  it("rejects bad input and keeps nothing", async () => {
    await expect(saveCompanyProfile({ ...acme, brandColor: "red;}body{display:none" }, null, {}, admin)).rejects.toThrow(ProfileError);
    await expect(saveCompanyProfile({ ...acme, state: "Iowa" }, null, {}, admin)).rejects.toThrow(/two-letter/);
    await expect(saveCompanyProfile(acme, { bytes: new TextEncoder().encode("TEST_ONLY not an image"), name: "logo.png" }, {}, admin)).rejects.toThrow(/PNG or JPEG/);
    expect(await prisma.companySetting.count({ where: { key: "companyProfile" } })).toBe(0);
    // an invalid color stored by hand is ignored, never injected
    expect(resolveProfile({ brandColor: "red;}" }).brandColor).toBeNull();
  });

  it("clearing every field returns the deployment to BTR", async () => {
    await saveCompanyProfile(acme, null, {}, admin);
    await saveCompanyProfile({}, null, {}, admin);
    expect((await getCompany()).name).toBe("BTR Contracting");
    expect(await estimatorSystemPrompt()).toBe(CLAUDE_MD);
  });
});
