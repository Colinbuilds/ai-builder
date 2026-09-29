import { prisma } from "@/lib/db";

export const phoneKey = (phone: string | null | undefined) => {
  const d = (phone ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length >= 7 ? ten : null;
};
export const normEmail = (e: string | null | undefined) => (e ?? "").trim().toLowerCase() || null;
// Word set, ignoring punctuation, order, and legal suffixes: "The Weitz Co., Inc." == "weitz"
export const companyKey = (n: string) =>
  n
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !["inc", "llc", "co", "corp", "company", "the", "ltd"].includes(w))
    .sort()
    .join(" ");

export async function findDuplicateContacts(c: { email?: string | null; phone?: string | null; firstName: string; lastName: string }) {
  const email = normEmail(c.email);
  const pk = phoneKey(c.phone);
  const or = [
    ...(email ? [{ email }] : []),
    ...(pk ? [{ phoneKey: pk }] : []),
    { firstName: c.firstName.trim(), lastName: c.lastName.trim() },
  ];
  return prisma.contact.findMany({ where: { OR: or }, include: { company: true }, take: 5 });
}

export async function findDuplicateCompanies(name: string) {
  const key = companyKey(name);
  if (!key) return [];
  const all = await prisma.company.findMany({ select: { id: true, name: true, type: true } });
  return all.filter((c) => companyKey(c.name) === key).slice(0, 5);
}
