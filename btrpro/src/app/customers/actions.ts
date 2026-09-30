"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { findDuplicateCompanies, findDuplicateContacts, normEmail, phoneKey } from "@/lib/customers";

export type CustomerResult = { problems: string[]; duplicates?: { id: string; label: string; href: string }[] } | null;

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const TYPES = ["BUILDER", "GC", "OWNER", "PROPERTY_MANAGER", "PUBLIC_AGENCY", "ARCHITECT", "SUBCONTRACTOR", "SUPPLIER", "OTHER"];

export async function createCompanyAction(_: CustomerResult, f: FormData): Promise<CustomerResult> {
  await requireUser(["ADMIN", "ESTIMATOR"]);
  const name = str(f, "name");
  const type = String(f.get("type"));
  if (!name) return { problems: ["Company name is required."] };
  if (!TYPES.includes(type)) return { problems: ["Pick a company type."] };
  if (f.get("confirmDuplicate") !== "1") {
    const dups = await findDuplicateCompanies(name);
    if (dups.length)
      return {
        problems: ["This looks like a company that already exists. Use it, or save anyway."],
        duplicates: dups.map((d) => ({ id: d.id, label: `${d.name} (${d.type.replace(/_/g, " ").toLowerCase()})`, href: `/customers/companies/${d.id}` })),
      };
  }
  const c = await prisma.company.create({
    data: { name, type: type as never, phone: str(f, "phone"), email: normEmail(str(f, "email")), address: str(f, "address"), notes: str(f, "notes") },
  });
  revalidatePath("/customers");
  redirect(`/customers/companies/${c.id}`);
}

export async function createContactAction(_: CustomerResult, f: FormData): Promise<CustomerResult> {
  await requireUser(["ADMIN", "ESTIMATOR"]);
  const firstName = str(f, "firstName");
  const lastName = str(f, "lastName");
  if (!firstName || !lastName) return { problems: ["First and last name are required."] };
  const email = normEmail(str(f, "email"));
  const phone = str(f, "phone");
  if (f.get("confirmDuplicate") !== "1") {
    const dups = await findDuplicateContacts({ firstName, lastName, email, phone });
    if (dups.length)
      return {
        problems: ["A contact with the same name, email, or phone already exists. Use it, or save anyway."],
        duplicates: dups.map((d) => ({
          id: d.id,
          label: `${d.firstName} ${d.lastName}${d.company ? `, ${d.company.name}` : ""}${d.email ? ` · ${d.email}` : ""}${d.phone ? ` · ${d.phone}` : ""}`,
          href: d.companyId ? `/customers/companies/${d.companyId}` : `/customers?q=${encodeURIComponent(d.lastName)}`,
        })),
      };
  }
  const companyId = str(f, "companyId");
  await prisma.contact.create({
    data: {
      firstName,
      lastName,
      title: str(f, "title"),
      companyId,
      email,
      phone,
      phoneKey: phoneKey(phone),
      address: str(f, "address"),
      notes: str(f, "notes"),
    },
  });
  revalidatePath("/customers");
  const back = str(f, "returnTo");
  redirect(back && back.startsWith("/") ? back : companyId ? `/customers/companies/${companyId}` : "/customers");
}
