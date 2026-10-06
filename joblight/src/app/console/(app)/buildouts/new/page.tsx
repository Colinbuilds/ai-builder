import { prisma } from "@/lib/db";
import { BuildoutForm } from "@/components/buildout-form";

export default async function NewBuildout({ searchParams }: { searchParams: Promise<{ lead?: string }> }) {
  const leadId = (await searchParams).lead;
  const lead = leadId ? await prisma.lead.findUnique({ where: { id: leadId } }) : null;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold">New buildout{lead ? ` — from ${lead.company}` : ""}</h1>
      <p className="text-sm text-muted">
        A buildout is one company&apos;s own Joblight: a Railway service with its own volume and database. Create the service in Railway (see the README), then record it here.
      </p>
      <BuildoutForm
        prefill={lead ? { company: lead.company, trade: lead.trade, users: lead.users ?? 1, ownerName: lead.name, ownerEmail: lead.email, notes: lead.message ?? null, leadId: lead.id } : undefined}
      />
    </div>
  );
}
