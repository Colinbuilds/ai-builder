import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadPlan, type PlannedPerson } from "@/lib/directory";
import { AutoRefresh } from "@/components/receipts/auto-refresh";
import { ImportDirectoryForm, RereadButton } from "@/components/customers/directory-forms";
import { Badge } from "@/components/ui/badge";

export default async function DirectoryPreview({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const exists = await prisma.directoryImport.findUnique({ where: { id }, select: { id: true } });
  if (!exists) notFound();
  const { imp, d, plan } = await loadPlan(id, null);
  const companies = await prisma.company.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const guess = imp.companyId ?? (d?.companyName ? (companies.find((c) => c.name.toLowerCase().includes(d.companyName!.toLowerCase().split(/\s+/)[0])) ?.id ?? null) : null);
  const person = (p: PlannedPerson) => (
    <li key={p.key} className="flex flex-wrap items-baseline gap-x-2">
      <span className="font-medium">{p.name}</span>
      {p.title && <span className="text-muted-foreground">{p.title}</span>}
      <span className="text-muted-foreground">{[p.cell && `cell ${p.cell}`, p.direct && `direct ${p.direct}`, p.email].filter(Boolean).join(" · ")}</span>
      {p.existingId ? <Badge variant="outline">update</Badge> : <Badge>new</Badge>}
      {p.alsoAt.length > 0 && <span className="text-xs text-muted-foreground">also listed at {p.alsoAt.join(", ")}</span>}
    </li>
  );
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <div>
        <Link href={imp.companyId ? `/customers/companies/${imp.companyId}` : "/customers"} className="text-sm text-muted-foreground">
          ← Back
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Staff directory</h1>
        <p className="text-sm text-muted-foreground">
          {imp.fileName}
          {d?.updated && ` · updated ${d.updated}`}
        </p>
      </div>
      {imp.status === "READING" && (
        <p className="rounded-lg border border-btr-line p-4 text-sm">
          <AutoRefresh /> Reading the directory… a long one takes a minute or two. This page updates by itself.
        </p>
      )}
      {imp.status === "FAILED" && (
        <div className="flex flex-col gap-2 rounded-lg border border-red-300 p-4 text-sm">
          <p>Couldn&apos;t read it: {imp.error}</p>
          {user.role !== "VIEWER" && <RereadButton id={id} />}
        </div>
      )}
      {imp.status === "IMPORTED" && imp.companyId && (
        <p className="rounded-lg border border-btr-line p-4 text-sm">
          Imported.{" "}
          <Link className="text-btr-link hover:underline" href={`/customers/companies/${imp.companyId}`}>
            Open the account →
          </Link>
        </p>
      )}
      {d && plan && (
        <>
          <div className="text-sm">
            <p className="font-medium">{[d.companyName, d.companyPhone, d.companyAddress].filter(Boolean).join(" · ")}</p>
            <p className="text-muted-foreground">
              {plan.properties.length} properties ({plan.counts.newProperties} new) · {plan.people.length} people ({plan.counts.newPeople} new, {plan.counts.updatedPeople} already on file)
            </p>
            {d.notes.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                {d.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </div>
          {imp.status === "READ" && user.role !== "VIEWER" && (
            <ImportDirectoryForm id={id} companies={companies} defaultCompanyId={guess} suggestedName={d.companyName ?? ""} />
          )}
          <section className="flex flex-col gap-1 text-sm">
            <h2 className="font-semibold">Office</h2>
            <ul className="flex flex-col gap-1">{plan.people.filter((p) => !p.property).map(person)}</ul>
          </section>
          {plan.properties.map((pr) => {
            const staff = plan.people.filter((p) => p.property === pr.name);
            return (
              <section key={pr.name} className="flex flex-col gap-1 border-t border-btr-line pt-3 text-sm">
                <h2 className="flex flex-wrap items-center gap-2 font-semibold">
                  {pr.name} {pr.existingId ? <Badge variant="outline">update</Badge> : <Badge>new</Badge>}
                  {pr.department && <Badge variant="outline">department</Badge>}
                </h2>
                <p className="text-muted-foreground">{[pr.address, pr.phone, pr.email].filter(Boolean).join(" · ") || "No address listed"}</p>
                {pr.sharedWith.length > 0 && <p className="text-xs text-muted-foreground">Shares an office and staff with {pr.sharedWith.join(", ")}</p>}
                <ul className="flex flex-col gap-1">{staff.map(person)}</ul>
              </section>
            );
          })}
          {plan.notListed.length > 0 && (
            <section className="text-sm">
              <h2 className="font-semibold">On the account but not in this directory</h2>
              <p className="text-muted-foreground">Left as they are — check whether they&apos;ve moved on: {plan.notListed.map((c) => `${c.firstName} ${c.lastName}`).join(", ")}</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
