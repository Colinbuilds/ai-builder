// TEST_ONLY staff directory (made-up company, people and numbers). The AI is faked.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { setAiClientForTests } from "@/lib/ai/claude";
import { importDirectory, loadPlan, planDirectory, readDirectory, splitName, startDirectoryImport, type Directory } from "@/lib/directory";

afterAll(() => {
  setAiClientForTests(null);
  return prisma.$disconnect();
});

const tag = Date.now().toString(36);
const dir = (over: Partial<Directory> = {}): Directory => ({
  companyName: `TEST_ONLY Oakview Management ${tag}`,
  companyPhone: "402-555-0100",
  companyAddress: "100 Test Plaza (TEST_ONLY)",
  updated: "1/1/26",
  notes: [],
  offices: [
    {
      kind: "CORPORATE",
      names: ["Corporate Office"],
      addresses: [null],
      phone: null,
      email: null,
      people: [
        { name: "Ada Test", title: "President", cell: "402-555-0101", direct: "555.0102", email: `ada.${tag}@example.test` },
        { name: "Rex Regional", title: "Regional Manager", cell: "402-555-0103", direct: null, email: `rex.${tag}@example.test` },
      ],
    },
    {
      kind: "PROPERTY",
      names: ["MAPLE RIDGE", "Maple Ridge South"],
      addresses: ["1 Maple Rd (TEST_ONLY)", "3 Maple Rd (TEST_ONLY)"],
      phone: "402-555-0200",
      email: `maple.${tag}@example.test`,
      people: [
        { name: "Rex Regional", title: "Regional Manager", cell: "402-555-0103", direct: null, email: `rex.${tag}@example.test` },
        { name: "Mary Ann Site", title: "Community Manager", cell: "402-555-0201", direct: null, email: `mary.${tag}@example.test` },
        { name: "Leo Lease", title: "Leasing Professional", cell: null, direct: null, email: null },
      ],
    },
    {
      kind: "PROPERTY",
      names: ["Cedar Court"],
      addresses: ["9 Cedar Ct (TEST_ONLY)"],
      phone: null,
      email: null,
      people: [{ name: "Rex Regional", title: "Regional Manager", cell: "402-555-0103", direct: null, email: `rex.${tag}@example.test` }],
    },
    { kind: "DEPARTMENT", names: ["Construction"], addresses: [null], phone: null, email: null, people: [{ name: "Cal Crew", title: "Director", cell: "402-555-0301", direct: null, email: null }] },
  ],
  ...over,
});

const fake = (d: Directory) =>
  setAiClientForTests({ beta: { messages: { parse: async () => ({ stop_reason: "end_turn", model: "fake", parsed_output: d }) } } } as never);

describe("staff directory import", () => {
  it("splits names at the last space", () => {
    expect(splitName("Mary Ann  Site")).toEqual({ firstName: "Mary Ann", lastName: "Site" });
    expect(splitName("Cher")).toEqual({ firstName: "Cher", lastName: "" });
  });

  it("plans one entry per person; office staff stay off the properties; shared offices noted", () => {
    const plan = planDirectory(dir(), { properties: [], contacts: [] });
    expect(plan.properties.map((p) => p.name)).toEqual(["Maple Ridge", "Maple Ridge South", "Cedar Court", "Construction"]);
    expect(plan.properties[1]).toMatchObject({ address: "3 Maple Rd (TEST_ONLY)", sharedWith: ["Maple Ridge"] });
    expect(plan.properties[3].department).toBe(true);
    const rex = plan.people.filter((p) => p.name === "Rex Regional");
    expect(rex).toHaveLength(1);
    expect(rex[0]).toMatchObject({ property: null, alsoAt: ["Maple Ridge", "Cedar Court"] });
    expect(plan.people.find((p) => p.name === "Mary Ann Site")?.property).toBe("Maple Ridge");
  });

  it("reads, imports, then re-imports a newer directory without duplicates", async () => {
    const a = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const actor = { id: a.id, name: a.name, role: "ADMIN" };
    fake(dir());
    const pdf = new TextEncoder().encode("%PDF-1.4\n% TEST_ONLY\n");
    const id = await startDirectoryImport({ bytes: pdf, name: "test-directory.pdf" }, null, a.id);
    await readDirectory(id);
    expect((await prisma.directoryImport.findUniqueOrThrow({ where: { id } })).status).toBe("READ");
    const r = await importDirectory(id, { newCompany: { name: `TEST_ONLY Oakview ${tag}`, type: "PROPERTY_MANAGER" } }, actor);
    expect(r).toMatchObject({ newProperties: 4, newPeople: 5, updatedPeople: 0 });
    const co = await prisma.company.findUniqueOrThrow({ where: { id: r.companyId }, include: { properties: true, contacts: true } });
    expect(co).toMatchObject({ type: "PROPERTY_MANAGER", phone: "402-555-0100" });
    const ada = co.contacts.find((c) => c.lastName === "Test")!;
    // direct line kept exactly as printed — no area code invented
    expect(ada).toMatchObject({ firstName: "Ada", phone: "402-555-0101", phone2: "555.0102", propertyId: null });
    const mary = co.contacts.find((c) => c.lastName === "Site")!;
    expect(mary.propertyId).toBe(co.properties.find((p) => p.name === "Maple Ridge")!.id);
    expect(co.contacts.find((c) => c.lastName === "Regional")!.notes).toMatch(/Also listed at Maple Ridge, Cedar Court/);
    await expect(importDirectory(id, { companyId: co.id }, actor)).rejects.toThrow(/already imported/);

    // newer directory: Mary got a new title, Leo left, someone new started
    const next = dir({ updated: "6/1/26" });
    next.offices[1].people = [
      { name: "Mary Ann Site", title: "Senior Community Manager", cell: "402-555-0201", direct: null, email: `mary.${tag}@example.test` },
      { name: "Nina New", title: "Leasing Professional", cell: "402-555-0202", direct: null, email: null },
    ];
    fake(next);
    const id2 = await startDirectoryImport({ bytes: pdf, name: "test-directory-2.pdf" }, co.id, a.id);
    await readDirectory(id2);
    const { plan } = await loadPlan(id2, co.id);
    expect(plan!.notListed.map((c) => c.firstName)).toEqual(["Leo"]);
    const r2 = await importDirectory(id2, { companyId: co.id }, actor);
    expect(r2).toMatchObject({ newProperties: 0, updatedProperties: 4, newPeople: 1, updatedPeople: 4, notListed: ["Leo Lease"] });
    const after = await prisma.contact.findMany({ where: { companyId: co.id } });
    expect(after).toHaveLength(6); // nobody deleted, nobody duplicated
    expect(after.find((c) => c.id === mary.id)!.title).toBe("Senior Community Manager");
    expect(await prisma.property.count({ where: { companyId: co.id } })).toBe(4);
  });

  it("marks a failed read and rejects unsupported files", async () => {
    const a = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    await expect(startDirectoryImport({ bytes: new TextEncoder().encode("hello"), name: "x.txt" }, null, a.id)).rejects.toThrow(/PDF, a Word/);
    setAiClientForTests({ beta: { messages: { parse: async () => { throw new Error("TEST_ONLY boom"); } } } } as never);
    const id = await startDirectoryImport({ bytes: new TextEncoder().encode("%PDF-1.4\n"), name: "bad.pdf" }, null, a.id);
    await readDirectory(id);
    expect(await prisma.directoryImport.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "FAILED" });
  });
});

describe("directory matching safety", () => {
  it("doesn't merge different people who share a printed phone number", () => {
    const d: Directory = {
      companyName: null, companyPhone: null, companyAddress: null, updated: null, notes: [],
      offices: [{ kind: "PROPERTY", names: ["Test Site"], addresses: [null], phone: null, email: null, people: [
        { name: "Pat One", title: null, cell: "402-555-0999", direct: null, email: null },
        { name: "Sam Two", title: null, cell: "402-555-0999", direct: null, email: null },
      ] }],
    };
    expect(planDirectory(d, { properties: [], contacts: [] }).people).toHaveLength(2);
    const existing = [{ id: "c1", firstName: "Pat", lastName: "One", email: null, phoneKey: "4025550999" }];
    const plan = planDirectory(d, { properties: [], contacts: existing });
    expect(plan.people.map((p) => p.existingId)).toEqual(["c1", null]);
  });
});
