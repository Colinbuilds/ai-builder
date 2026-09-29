import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CompanyForm, ContactForm } from "./forms";

type SP = Promise<{ kind?: string; companyId?: string; returnTo?: string }>;

export default async function NewCustomerPage({ searchParams }: { searchParams: SP }) {
  await requireUser(["ADMIN", "ESTIMATOR"]);
  const sp = await searchParams;
  const companies = await prisma.company.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const isCompany = sp.kind === "company";
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">{isCompany ? "New company" : "New contact"}</h1>
      {isCompany ? <CompanyForm /> : <ContactForm companies={companies} companyId={sp.companyId} returnTo={sp.returnTo} />}
    </div>
  );
}
