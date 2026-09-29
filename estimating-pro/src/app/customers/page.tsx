import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const { q } = await searchParams;
  const [companies, contacts] = await Promise.all([
    prisma.company.findMany({
      where: q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }, { phone: { contains: q } }] } : {},
      include: { _count: { select: { contacts: true, projects: true } } },
      orderBy: { name: "asc" },
      take: 200,
    }),
    prisma.contact.findMany({
      where: q
        ? { OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }, { email: { contains: q } }, { phone: { contains: q } }] }
        : {},
      include: { company: { select: { id: true, name: true } }, _count: { select: { projects: true } } },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 200,
    }),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Customers</h1>
        {user.role !== "VIEWER" && (
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/customers/new?kind=company">New company</Link>
            </Button>
            <Button asChild>
              <Link href="/customers/new?kind=contact">New contact</Link>
            </Button>
          </div>
        )}
      </div>
      <form method="get" className="flex gap-2">
        <Input name="q" defaultValue={q} placeholder="Name, email, or phone" className="w-72" />
        <Button variant="outline">Search</Button>
      </form>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Companies</h2>
        <Table>
          <THead>
            <TR>
              <TH>Company</TH>
              <TH>Type</TH>
              <TH>Phone</TH>
              <TH>Email</TH>
              <TH className="text-right">Contacts</TH>
              <TH className="text-right">Jobs</TH>
            </TR>
          </THead>
          <TBody>
            {companies.map((c) => (
              <TR key={c.id}>
                <TD>
                  <Link href={`/customers/companies/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                </TD>
                <TD>
                  <Badge variant="outline">{c.type.replace(/_/g, " ").toLowerCase()}</Badge>
                </TD>
                <TD>{c.phone ?? "—"}</TD>
                <TD>{c.email ?? "—"}</TD>
                <TD className="text-right tabular-nums">{c._count.contacts}</TD>
                <TD className="text-right tabular-nums">{c._count.projects}</TD>
              </TR>
            ))}
            {companies.length === 0 && (
              <TR>
                <TD colSpan={6} className="py-6 text-center text-muted-foreground">
                  No companies.
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Contacts</h2>
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Company</TH>
              <TH>Phone</TH>
              <TH>Email</TH>
              <TH className="text-right">Jobs</TH>
            </TR>
          </THead>
          <TBody>
            {contacts.map((c) => (
              <TR key={c.id}>
                <TD className="font-medium">
                  {c.lastName}, {c.firstName}
                  {c.title && <span className="font-normal text-muted-foreground"> · {c.title}</span>}
                </TD>
                <TD>{c.company ? <Link href={`/customers/companies/${c.company.id}`}>{c.company.name}</Link> : "Homeowner / individual"}</TD>
                <TD>{c.phone ?? "—"}</TD>
                <TD>{c.email ?? "—"}</TD>
                <TD className="text-right tabular-nums">{c._count.projects}</TD>
              </TR>
            ))}
            {contacts.length === 0 && (
              <TR>
                <TD colSpan={5} className="py-6 text-center text-muted-foreground">
                  No contacts.
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
      </section>
    </div>
  );
}
