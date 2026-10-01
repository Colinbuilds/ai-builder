// Customer staff directories (e.g. a property-management company's list of communities and staff):
// the AI reads the file, the office previews it, then it's imported as the company's properties and contacts.
// Re-importing a newer directory updates people (matched by email, then name, then cell + last name) and properties
// (matched by name) instead of duplicating them; nobody is deleted.
import { z } from "zod";
import JSZip from "jszip";
import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { readUpload, saveUpload } from "@/lib/storage";
import { aiParse } from "@/lib/ai/claude";
import { sniff } from "@/lib/portal/crew";
import { normEmail, phoneKey } from "@/lib/customers";

export class DirectoryError extends Error {}

const str = z.string().nullable();
export const DirectorySchema = z.object({
  companyName: str.describe("The company the directory belongs to"),
  companyPhone: str,
  companyAddress: str.describe("Corporate/main office address"),
  updated: str.describe("The 'updated' date printed on it, as written"),
  offices: z.array(
    z.object({
      kind: z.enum(["CORPORATE", "PROPERTY", "DEPARTMENT"]).describe("CORPORATE = main office staff list; PROPERTY = a site/community/building; DEPARTMENT = a team with no address (construction, commercial maintenance…)"),
      names: z.array(z.string()).describe("Property names in this block, as printed. Several when properties share one office and staff list (e.g. 'Glen Oaks', 'Barrington Park')"),
      addresses: z.array(str).describe("Street address for each name, same order; null if none printed"),
      phone: str.describe("Office phone for the block"),
      email: str.describe("Office email for the block"),
      people: z.array(
        z.object({
          name: z.string(),
          title: str,
          cell: str.describe("Cell phone exactly as printed"),
          direct: str.describe("Direct/office line exactly as printed (may lack an area code — copy it as printed)"),
          email: str,
        }),
      ),
    }),
  ),
  notes: z.array(z.string()).describe("Anything unreadable or ambiguous"),
});
export type Directory = z.infer<typeof DirectorySchema>;

const TASK = `Transcribe a company staff directory into the schema: every office/property block and every person in it.
Copy exactly what is printed — names, titles, phone numbers (don't add area codes), emails. Never invent anyone or any number; use null when a field is blank.
Titles can wrap onto two lines (e.g. "Leasing" / "Professional") — join them. Ordinals in addresses may be printed as superscript (e.g. "96 th St") — write them normally ("96th St").
Some pages may be images: read them too. Emergency/on-call numbers go in notes, not as people.`;

/** Text of a .docx (tables flattened to "cell | cell" rows) so it can be read like a PDF. */
async function docxText(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new DirectoryError("That Word file has no document text.");
  return xml
    .replace(/<\/w:tc>/g, " | ")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n");
}

export async function startDirectoryImport(file: { bytes: Uint8Array; name: string }, companyId: string | null, actorId: string) {
  if (!file.bytes.length) throw new DirectoryError("Choose the directory file.");
  if (file.bytes.length > 30 * 1024 * 1024) throw new DirectoryError("That file is over 30 MB.");
  const kind = sniff(file.bytes);
  const docx = !kind && file.bytes[0] === 0x50 && file.bytes[1] === 0x4b && /\.docx$/i.test(file.name);
  if (!kind && !docx) throw new DirectoryError("Upload the directory as a PDF, a Word (.docx) file, or a photo.");
  const fileUrl = await saveUpload(file.bytes, file.name, "directories");
  const imp = await prisma.directoryImport.create({ data: { companyId, fileName: file.name.slice(0, 200), fileUrl, createdById: actorId } });
  return imp.id;
}

export async function readDirectory(id: string) {
  const imp = await prisma.directoryImport.findUniqueOrThrow({ where: { id } });
  const bytes = new Uint8Array(await readUpload(imp.fileUrl));
  const kind = sniff(bytes);
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (kind === "pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(bytes).toString("base64") } });
  else if (kind) {
    const { resized } = await import("@/lib/photos/images");
    const jpg = await resized(bytes, 2400, 90);
    if (!jpg) throw new DirectoryError("Couldn't open that photo.");
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpg.toString("base64") } });
  } else content.push({ type: "text", text: `Directory (from a Word file):\n\n${(await docxText(bytes)).slice(0, 200_000)}` });
  content.push({ type: "text", text: "Transcribe this directory." });
  try {
    const { data } = await aiParse({ task: TASK, schema: DirectorySchema, effort: "medium", maxTokens: 32000, messages: [{ role: "user", content }] });
    await prisma.directoryImport.update({ where: { id }, data: { status: "READ", extracted: data, error: null } });
  } catch (e) {
    await prisma.directoryImport.update({ where: { id }, data: { status: "FAILED", error: e instanceof Error ? e.message : String(e) } });
  }
}

// ---------- planning (pure) ----------

export const splitName = (full: string) => {
  const n = full.replace(/\s+/g, " ").trim();
  const i = n.lastIndexOf(" ");
  return i < 0 ? { firstName: n, lastName: "" } : { firstName: n.slice(0, i), lastName: n.slice(i + 1) };
};
const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/’S\b/g, "’s").replace(/'S\b/g, "'s") : s);
const propKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type ExistingContact = { id: string; firstName: string; lastName: string; email: string | null; phoneKey: string | null };
export type PlannedPerson = {
  key: string;
  name: string;
  title: string | null;
  cell: string | null;
  direct: string | null;
  email: string | null;
  property: string | null; // property name (null = office/corporate)
  alsoAt: string[]; // other blocks they're listed in (regional managers)
  existingId: string | null;
};
export type PlannedProperty = { name: string; address: string | null; phone: string | null; email: string | null; sharedWith: string[]; existingId: string | null; department: boolean };

/** What an import would do: one entry per property and per person (people listed in several blocks appear once). */
export function planDirectory(d: Directory, existing: { properties: { id: string; name: string }[]; contacts: ExistingContact[] }) {
  const properties: PlannedProperty[] = [];
  for (const o of d.offices) {
    if (o.kind === "CORPORATE") continue;
    o.names.forEach((raw, i) => {
      const name = titleCase(raw.trim());
      if (!name || properties.some((p) => propKey(p.name) === propKey(name))) return;
      properties.push({
        name,
        address: o.addresses[i] ?? null,
        phone: o.phone,
        email: o.email,
        sharedWith: o.names.filter((_, j) => j !== i).map((x) => titleCase(x.trim())),
        existingId: existing.properties.find((p) => propKey(p.name) === propKey(name))?.id ?? null,
        department: o.kind === "DEPARTMENT",
      });
    });
  }
  const people = new Map<string, PlannedPerson>();
  const corporate = new Set(d.offices.filter((o) => o.kind === "CORPORATE").flatMap((o) => o.people.map((p) => normEmail(p.email) ?? p.name.toLowerCase())));
  for (const o of d.offices) {
    const block = o.kind === "CORPORATE" ? null : titleCase(o.names[0]?.trim() ?? "");
    for (const p of o.people) {
      const email = normEmail(p.email);
      // never key on phone alone: a directory may print an office line in several people's cell column
      const key = email ?? p.name.toLowerCase().replace(/\s+/g, " ").trim();
      const cur = people.get(key);
      if (cur) {
        // listed again (e.g. a regional manager under each community): keep the first home, note the others
        if (block && block !== cur.property && !cur.alsoAt.includes(block)) cur.alsoAt.push(block);
        cur.title ??= p.title;
        cur.cell ??= p.cell;
        cur.direct ??= p.direct;
        continue;
      }
      const { firstName, lastName } = splitName(p.name);
      const match = existing.contacts.find(
        (c) =>
          (email && normEmail(c.email) === email) ||
          (c.firstName.toLowerCase() === firstName.toLowerCase() && c.lastName.toLowerCase() === lastName.toLowerCase()) ||
          // same cell + same last name (e.g. "Kathy" vs "Katherine")
          (!!phoneKey(p.cell) && c.phoneKey === phoneKey(p.cell) && !!lastName && c.lastName.toLowerCase() === lastName.toLowerCase()),
      );
      people.set(key, {
        key,
        name: p.name.trim(),
        title: p.title,
        cell: p.cell,
        direct: p.direct,
        email,
        // corporate staff (incl. regional managers) belong to the office, not one community
        property: corporate.has(email ?? p.name.toLowerCase()) ? null : block,
        alsoAt: [],
        existingId: match?.id ?? null,
      });
    }
  }
  const list = [...people.values()];
  const seen = new Set(list.map((p) => p.existingId).filter(Boolean));
  return {
    properties,
    people: list,
    counts: {
      newProperties: properties.filter((p) => !p.existingId).length,
      updatedProperties: properties.filter((p) => p.existingId).length,
      newPeople: list.filter((p) => !p.existingId).length,
      updatedPeople: list.filter((p) => p.existingId).length,
    },
    notListed: existing.contacts.filter((c) => !seen.has(c.id)),
  };
}

// ---------- import ----------

export async function loadPlan(id: string, companyId: string | null) {
  const imp = await prisma.directoryImport.findUniqueOrThrow({ where: { id } });
  const d = imp.extracted as Directory | null;
  if (!d) return { imp, d: null, plan: null };
  const cid = companyId ?? imp.companyId;
  const [properties, contacts] = cid
    ? await Promise.all([
        prisma.property.findMany({ where: { companyId: cid }, select: { id: true, name: true } }),
        prisma.contact.findMany({ where: { companyId: cid }, select: { id: true, firstName: true, lastName: true, email: true, phoneKey: true } }),
      ])
    : [[], []];
  return { imp, d, plan: planDirectory(d, { properties, contacts }) };
}

export async function importDirectory(id: string, target: { companyId: string } | { newCompany: { name: string; type: string } }, actor: { id: string; name: string; role: string }) {
  if (actor.role === "VIEWER") throw new DirectoryError("Viewers can't import.");
  const imp0 = await prisma.directoryImport.findUniqueOrThrow({ where: { id } });
  if (imp0.status === "IMPORTED") throw new DirectoryError("This directory is already imported.");
  let companyId: string;
  if ("companyId" in target) companyId = target.companyId;
  else {
    const d0 = imp0.extracted as Directory | null;
    if (!target.newCompany.name.trim()) throw new DirectoryError("Enter the company name.");
    companyId = (
      await prisma.company.create({
        data: { name: target.newCompany.name.trim(), type: target.newCompany.type as never, phone: d0?.companyPhone ?? null, address: d0?.companyAddress ?? null, notes: `Created from ${imp0.fileName}` },
      })
    ).id;
  }
  const { d, plan } = await loadPlan(id, companyId);
  if (!d || !plan) throw new DirectoryError("This directory hasn't been read yet.");
  const source = `${imp0.fileName}${d.updated ? ` (updated ${d.updated})` : ""}`;
  const propId = new Map<string, string>();
  for (const p of plan.properties) {
    const notes = [p.department ? "Department (no site)" : null, p.sharedWith.length ? `Office and staff shared with ${p.sharedWith.join(", ")}` : null].filter(Boolean).join(". ") || null;
    const data = { name: p.name, address: p.address, phone: p.phone, email: normEmail(p.email), notes, source };
    const row = p.existingId ? await prisma.property.update({ where: { id: p.existingId }, data }) : await prisma.property.create({ data: { ...data, companyId } });
    propId.set(p.name, row.id);
  }
  for (const p of plan.people) {
    const { firstName, lastName } = splitName(p.name);
    const notes = p.alsoAt.length ? `Also listed at ${p.alsoAt.join(", ")}` : null;
    const data = {
      firstName,
      lastName,
      title: p.title,
      email: p.email,
      phone: p.cell ?? p.direct,
      phoneKey: phoneKey(p.cell ?? p.direct),
      phone2: p.cell && p.direct ? p.direct : null,
      companyId,
      propertyId: p.property ? (propId.get(p.property) ?? null) : null,
      ...(notes ? { notes } : {}),
    };
    if (p.existingId) await prisma.contact.update({ where: { id: p.existingId }, data });
    else await prisma.contact.create({ data });
  }
  const result = { ...plan.counts, notListed: plan.notListed.map((c) => `${c.firstName} ${c.lastName}`) };
  await prisma.directoryImport.update({ where: { id }, data: { status: "IMPORTED", companyId, importedAt: new Date(), result } });
  return { companyId, ...result };
}
