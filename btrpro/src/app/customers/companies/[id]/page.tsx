import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ReadinessBadge, StageBadge } from "@/components/projects/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const c = await prisma.company.findUnique({
    where: { id },
    include: {
      contacts: { orderBy: [{ lastName: "asc" }] },
      projects: { orderBy: { updatedAt: "desc" } },
    },
  });
  if (!c) notFound();
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
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Contacts</h2>
          {user.role !== "VIEWER" && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/customers/new?kind=contact&companyId=${c.id}`}>Add contact</Link>
            </Button>
          )}
        </div>
        <ul className="text-sm">
          {c.contacts.map((k) => (
            <li key={k.id}>
              <span className="font-medium">
                {k.firstName} {k.lastName}
              </span>
              <span className="text-muted-foreground"> {[k.title, k.phone, k.email].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
          {c.contacts.length === 0 && <li className="text-muted-foreground">No contacts yet.</li>}
        </ul>
      </section>
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
