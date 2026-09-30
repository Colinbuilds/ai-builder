import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { searchPriceItems } from "@/lib/price";
import { sheetDateStatus, describeDateStatus } from "@/lib/sheets/date-status";
import { BuilderForm } from "@/components/builders/builder-form";
import { BuilderUpload } from "@/components/builders/builder-upload";
import { ContactForm } from "@/app/customers/new/forms";
import { StageBadge } from "@/components/projects/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, formatUsd } from "@/lib/utils";

const TABS = [
  ["pricing", "Pricing"],
  ["jobs", "Jobs"],
  ["contacts", "Contacts"],
  ["overview", "Builder info"],
] as const;

export default async function BuilderPage({ params, searchParams }: { params: Promise<{ bid: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const { bid } = await params;
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "pricing";
  const b = await prisma.company.findUnique({
    where: { id: bid },
    include: {
      priceSheets: { where: { isActive: true }, include: { _count: { select: { items: true } } }, orderBy: { code: "asc" } },
      projects: { orderBy: { createdAt: "desc" }, select: { id: true, name: true, address: true, status: true, readiness: true, contractAmount: true, createdAt: true } },
      contacts: { orderBy: { lastName: "asc" } },
    },
  });
  if (!b || b.type !== "BUILDER") notFound();
  const canEdit = user.role !== "VIEWER";
  const items = tab === "pricing" && b.priceSheets.length ? await searchPriceItems({ q: sp.q, scope: { builderId: b.id, builderName: b.name, fallback: "MISSING" }, pageSize: 100 }) : null;
  const open = b.projects.filter((p) => !["CLOSED", "LOST", "PAID"].includes(p.status));

  return (
    <div className="flex flex-col gap-5">
      <Link href="/builders" className="text-sm text-muted-foreground">
        ← Builders
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{b.name}</h1>
        <Badge variant="blue">builder pricing</Badge>
        {b.poRequired && <Badge variant="outline">PO required</Badge>}
        <span className="text-sm text-muted-foreground">
          {[b.phone, b.email, b.abcAccount && `ABC acct ${b.abcAccount}`, `${open.length} open job${open.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
        </span>
      </div>
      {!b.pricingFallback && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
          Choose what happens when an item isn&apos;t on {b.name}&apos;s pricing (Builder info tab). Until then those items stay MISSING.
        </p>
      )}
      <nav className="flex gap-1 border-b text-sm">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/builders/${b.id}?tab=${k}`} className={`-mb-px border-b-2 px-3 py-2 ${tab === k ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {label}
            {k === "jobs" && b.projects.length > 0 && <span className="ml-1 rounded-full bg-muted px-1.5 text-xs">{b.projects.length}</span>}
          </Link>
        ))}
      </nav>

      {tab === "pricing" && (
        <div className="flex flex-col gap-4">
          {sp.applied && <p className="text-sm text-green-700">Pricing is live. {b.name} jobs price from it now; re-run takeoffs on open estimates to pick up changes.</p>}
          <p className="text-sm text-muted-foreground">
            Every {b.name} job uses these prices. Items not on them: {b.pricingFallback === "STANDARD" ? "BTR standard price, flagged on the line" : "MISSING"}.
          </p>
          {b.priceSheets.length > 0 ? (
            <Table>
              <THead>
                <TR>
                  <TH>Sheet</TH>
                  <TH>Items</TH>
                  <TH>Dates</TH>
                  <TH>Account</TH>
                </TR>
              </THead>
              <TBody>
                {b.priceSheets.map((s) => {
                  const st = sheetDateStatus(s);
                  return (
                    <TR key={s.id}>
                      <TD>
                        <span className="font-mono">{s.code}</span> {s.name}
                        {s.warning && <span className="block text-xs text-amber-700">{s.warning}</span>}
                      </TD>
                      <TD className="tabular-nums">{s._count.items}</TD>
                      <TD>
                        <Badge variant={st.status === "CURRENT" ? "green" : st.status === "EXPIRED" ? "red" : "amber"}>{st.status.toLowerCase()}</Badge>
                        <span className="block text-xs text-muted-foreground">{describeDateStatus(st)}</span>
                      </TD>
                      <TD className="text-sm">{s.account ?? "—"}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          ) : (
            <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">No pricing loaded for {b.name}. Upload the sheet ABC gave them.</p>
          )}
          {user.role === "ADMIN" &&
            (b.sheetPrefix ? (
              <BuilderUpload companyId={b.id} prefix={b.sheetPrefix} sheets={b.priceSheets.map((s) => ({ code: s.code, name: s.name }))} />
            ) : (
              <p className="text-sm">
                Set a sheet prefix on the{" "}
                <Link href={`/builders/${b.id}?tab=overview`} className="underline">
                  Builder info
                </Link>{" "}
                tab to upload pricing.
              </p>
            ))}
          {items && (
            <section className="flex flex-col gap-2">
              <form className="flex gap-2">
                <input type="hidden" name="tab" value="pricing" />
                <Input name="q" defaultValue={sp.q ?? ""} placeholder={`Search ${b.name} pricing: item #, product`} className="max-w-md" />
                <Button size="sm" variant="outline">
                  Search
                </Button>
              </form>
              <Table>
                <THead>
                  <TR>
                    <TH>Item #</TH>
                    <TH>Description</TH>
                    <TH className="text-right">Price</TH>
                    <TH>UOM</TH>
                    <TH>Sheet</TH>
                  </TR>
                </THead>
                <TBody>
                  {items.items.map((i) => (
                    <TR key={i.id}>
                      <TD className="font-mono text-xs">{i.itemNumber}</TD>
                      <TD>{i.description}</TD>
                      <TD className="text-right tabular-nums">{i.priceStatus === "CALL" || i.unitPrice == null ? "CALL — get quote" : formatUsd(i.unitPrice)}</TD>
                      <TD>{i.uom}</TD>
                      <TD className="font-mono text-xs">{i.sheet.code}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              {items.total > items.items.length && <p className="text-xs text-muted-foreground">Showing {items.items.length} of {items.total}. Search to narrow.</p>}
            </section>
          )}
        </div>
      )}

      {tab === "jobs" && (
        <div className="flex flex-col gap-3">
          {canEdit && (
            <Link href={`/projects/new?client=${b.id}`} className="self-start">
              <Button size="sm">New {b.name} job</Button>
            </Link>
          )}
          <Table>
            <THead>
              <TR>
                <TH>Job</TH>
                <TH>Stage</TH>
                <TH className="text-right">Contract</TH>
                <TH>Created</TH>
              </TR>
            </THead>
            <TBody>
              {b.projects.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    {p.address && <span className="block text-xs text-muted-foreground">{p.address}</span>}
                  </TD>
                  <TD>
                    <StageBadge stage={p.status} />
                  </TD>
                  <TD className="text-right tabular-nums">{p.contractAmount != null && user.role !== "VIEWER" ? formatUsd(p.contractAmount) : "—"}</TD>
                  <TD>{formatDate(p.createdAt)}</TD>
                </TR>
              ))}
              {b.projects.length === 0 && (
                <TR>
                  <TD colSpan={4} className="text-muted-foreground">
                    No jobs for {b.name} yet.
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
        </div>
      )}

      {tab === "contacts" && (
        <div className="flex flex-col gap-3">
          {b.contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contacts yet. Add superintendents, purchasing, and accounts payable.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Title</TH>
                  <TH>Phone</TH>
                  <TH>Email</TH>
                </TR>
              </THead>
              <TBody>
                {b.contacts.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      {c.firstName} {c.lastName}
                    </TD>
                    <TD>{c.title ?? "—"}</TD>
                    <TD>{c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : "—"}</TD>
                    <TD>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          {canEdit && (
            <div className="max-w-xl rounded-md border p-3">
              <p className="mb-2 text-sm font-medium">Add a contact</p>
              <ContactForm companies={[{ id: b.id, name: b.name }]} companyId={b.id} returnTo={`/builders/${b.id}?tab=contacts`} />
            </div>
          )}
        </div>
      )}

      {tab === "overview" && (canEdit ? <BuilderForm b={b} lockPrefix={b.priceSheets.length > 0} /> : <p className="text-sm whitespace-pre-wrap">{[b.standardSpecs, b.billingTerms, b.notes].filter(Boolean).join("\n\n")}</p>)}
    </div>
  );
}
