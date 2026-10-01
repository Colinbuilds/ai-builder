import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NewLeadForm } from "@/components/projects/new-lead-form";
import { getMarketView } from "@/lib/market";
import { createProjectAction } from "../actions";

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; property?: string }>;
}) {
  const { client, property } = await searchParams;
  const me = await requireUser(["ADMIN", "ESTIMATOR", "OFFICE"]);
  const view = await getMarketView();
  const [companies, users, properties] = await Promise.all([
    prisma.company.findMany({
      select: { id: true, name: true, type: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { role: { not: "VIEWER" } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.property.findMany({ select: { id: true, name: true, address: true, companyId: true }, orderBy: { name: "asc" } }),
  ]);
  const prop = properties.find((p) => p.id === property);
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">New job / lead</h1>
      <NewLeadForm
        action={createProjectAction}
        companies={companies}
        users={users}
        properties={properties}
        me={me.id}
        market={prop ? "COMMERCIAL" : client ? "RESIDENTIAL" : view === "COMMERCIAL" ? "COMMERCIAL" : "RESIDENTIAL"}
        clientCompanyId={prop?.companyId ?? client ?? null}
        propertyId={prop?.id ?? null}
      />
    </div>
  );
}
