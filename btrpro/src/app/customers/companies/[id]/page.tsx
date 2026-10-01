import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ReadinessBadge, StageBadge } from "@/components/projects/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { DirectoryUpload } from "@/components/customers/directory-forms";

export default async function CompanyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ imported?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { imported } = await searchParams;
  const imp = imported ? await prisma.directoryImport.findUnique({ where: { id: imported } }) : null;
  const res = imp?.result as { newProperties: number; updatedProperties: number; newPeople: number; updatedPeople: number; notListed: string[] } | null | undefined;
  const c = await prisma.company.findUnique({
    where: { id },
    include: {
      contacts: { orderBy: [{ lastName: "asc" }] },
      properties: { orderBy: { name: "asc" }, include: { _count: { select: { projects: true } } } },
      projects: { orderBy: { updatedAt: "desc" } },
    },
  });
  if (!c) notFound();
  const office = c.contacts.filter((k) => !k.propertyId);
  const contactLine = (k: (typeof c.contacts)[number]) => (
    <li key={k.id}>
      <span className="font-medium">
        {k.firstName} {k.lastName}
      </span>
      <span className="text-muted-foreground"> {[k.title, k.phone, k.phone2 && `direct ${k.phone2}`, k.email].filter(Boolean).join(" · ")}</span>
      {k.notes?.startsWith("Also listed at") && <span className="text-xs text-muted-foreground"> · {k.notes.replace(/^Also/, "also")}</span>}
    </li>
  );
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <div>
        <Link href="/customers" className="text-sm text-muted-foreground">
          ← Customers
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold">
          {c.name} <Badge variant="outline">{c.type.replace(/_/g, " ").toLowerCase()}</Badge>
        </h1>
        <p className="text-sm text-muted-foreground">{[c.phone, c.email, c.address].filter(Boolean).join(" · ")}</p>
        {c.notes && <p className="mt-1 text-sm">{c.notes}</p>}
      </div>
      {res && (
        <p className="rounded-lg border border-btr-line bg-btr-blue-soft p-3 text-sm">
          Directory imported: {res.newProperties} new and {res.updatedProperties} updated properties, {res.newPeople} new and {res.updatedPeople} updated people.
          {res.notListed.length > 0 && ` Not in the new directory (left as they are): ${res.notListed.join(", ")}.`}
        </p>
      )}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{c.properties.length ? "Office contacts" : "Contacts"}</h2>
          {user.role !== "VIEWER" && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/customers/new?kind=contact&companyId=${c.id}`}>Add contact</Link>
            </Button>
          )}
        </div>
        <ul className="text-sm">
          {office.map(contactLine)}
          {c.contacts.length === 0 && <li className="text-muted-foreground">No contacts yet.</li>}
        </ul>
        {user.role !== "VIEWER" && <DirectoryUpload companyId={c.id} compact />}
      </section>
      {c.properties.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Properties ({c.properties.length})</h2>
          {c.properties.map((p) => {
            const staff = c.contacts.filter((k) => k.propertyId === p.id);
            return (
              <div key={p.id} id={`property-${p.id}`} className="border-t border-btr-line pt-2 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground">{[p.address, p.phone, p.email].filter(Boolean).join(" · ")}</span>
                  {p._count.projects > 0 && <span className="text-xs text-muted-foreground">{p._count.projects} job{p._count.projects === 1 ? "" : "s"}</span>}
                  {user.role !== "VIEWER" && (
                    <Link href={`/projects/new?property=${p.id}`} className="text-xs text-btr-link hover:underline">
                      New job here
                    </Link>
                  )}
                </div>
                {p.notes && <p className="text-xs text-muted-foreground">{p.notes}</p>}
                {staff.length > 0 && <ul className="mt-1 pl-3">{staff.map(contactLine)}</ul>}
              </div>
            );
          })}
        </section>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Jobs</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {c.projects.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2">
              <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                {p.name}
              </Link>
              <StageBadge stage={p.status} />
              <ReadinessBadge readiness={p.readiness} />
              {p.bidDueDate && <span className="text-muted-foreground">bid due {formatDate(p.bidDueDate)}</span>}
            </li>
          ))}
          {c.projects.length === 0 && <li className="text-muted-foreground">No jobs yet.</li>}
        </ul>
      </section>
    </div>
  );
}
