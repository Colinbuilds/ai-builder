import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { emailConfigured } from "@/lib/email/send";
import { qboConnected } from "@/lib/integrations/quickbooks";
import { serviceAccountEmail } from "@/lib/integrations/google-sa";
import { stripeConfigured } from "@/lib/billing/service";
import {
  AX_FIELDS,
  AX_FIELD_KEYS,
  previewAccuLynx,
} from "@/lib/import/acculynx";
import {
  LoadAccuLynx,
  MapAccuLynx,
} from "@/components/import/acculynx-forms";
import { Badge } from "@/components/ui/badge";

type Check = {
  done: boolean;
  label: string;
  detail: string;
  href?: string;
  optional?: boolean;
};

export default async function AccuLynxMigration({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; n?: string }>;
}) {
  await requireUser(["ADMIN"]);
  const { f, n } = await searchParams;
  const s = await getSettings();
  const [users, scheduleJobs, axJobs, crews, linkedCrews, qbo] =
    await Promise.all([
      prisma.user.count(),
      prisma.project.count({ where: { importKey: { not: null } } }),
      prisma.projectActivity.count({
        where: {
          kind: "import",
          OR: [
            { text: { startsWith: "Imported from AccuLynx" } },
            { text: { startsWith: "Linked to AccuLynx" } },
          ],
        },
      }),
      prisma.crew.count({ where: { active: true } }),
      prisma.crew.count({
        where: { active: true, portalToken: { not: null } },
      }),
      qboConnected(),
    ]);
  const checks: Check[] = [
    {
      done: users > 1,
      label: "Team members have sign-ins",
      detail: `${users} user${users === 1 ? "" : "s"}`,
      href: "/admin/users",
    },
    {
      done: scheduleJobs > 0,
      label: "Jobs brought in from the Drive schedules",
      detail: `${scheduleJobs} jobs`,
      href: "/settings/import-jobs",
    },
    {
      done: axJobs > 0,
      label: "AccuLynx jobs export imported",
      detail: `${axJobs} jobs imported or linked`,
      href: "#import",
    },
    {
      done:
        s.markupPct != null &&
        s.depositPct != null &&
        s.invoiceNetDays != null &&
        !!s.remitTo,
      label: "Company settings: markup, deposit, invoice terms, how to pay",
      detail:
        [
          s.markupPct == null && "markup",
          s.depositPct == null && "deposit",
          s.invoiceNetDays == null && "invoice days",
          !s.remitTo && "remit-to",
        ]
          .filter(Boolean)
          .join(", ") || "set",
      href: "/settings/company",
    },
    {
      done: !!serviceAccountEmail(),
      label: "Google Drive for the app (service account)",
      detail: serviceAccountEmail() ?? "GOOGLE_SERVICE_ACCOUNT_JSON not set",
      href: "/settings/integrations",
    },
    {
      done: emailConfigured(),
      label: "Outgoing email (invoices, proposals, change orders, orders)",
      detail: emailConfigured()
        ? "configured"
        : "not set — links must be copied by hand",
      href: "/settings/integrations",
    },
    {
      done: qbo,
      label: "QuickBooks Online connected",
      detail: qbo ? "connected" : "not connected",
      href: "/settings/integrations",
      optional: true,
    },
    {
      done: stripeConfigured(),
      label: "Online card payments (Stripe)",
      detail: stripeConfigured() ? "on" : "off — customers pay by check/ACH",
      href: "/settings/integrations",
      optional: true,
    },
    {
      done: crews > 0 && linkedCrews === crews,
      label: "Crews have their phone links",
      detail: `${linkedCrews} of ${crews}`,
      href: "/crews",
    },
  ];
  let preview: Awaited<ReturnType<typeof previewAccuLynx>> | null = null;
  let error: string | null = null;
  if (f && n && f.includes("imports/acculynx")) {
    try {
      preview = await previewAccuLynx(f, n);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Import from AccuLynx</h1>
        <p className="text-sm text-muted-foreground">
          BTRpro has replaced AccuLynx. Use this once to bring the old jobs and
          history over, then check the setup list below.
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Setup checklist</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {checks.map((c) => (
            <li key={c.label} className="flex flex-wrap items-center gap-2">
              <Badge
                variant={c.done ? "green" : c.optional ? "outline" : "amber"}
              >
                {c.done ? "done" : c.optional ? "optional" : "to do"}
              </Badge>
              {c.href ? (
                <Link href={c.href} className="hover:underline">
                  {c.label}
                </Link>
              ) : (
                c.label
              )}
              <span className="text-xs text-muted-foreground">{c.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <section id="import" className="flex flex-col gap-3">
        <h2 className="font-semibold">Import the AccuLynx jobs export</h2>
        <p className="text-sm text-muted-foreground">
          In AccuLynx, open the Jobs list (all milestones you want, including
          Closed for history), and export it to Excel/CSV. Upload it here.
          Customers and companies come along with each job; jobs already in
          BTRpro at the same address are linked, and re-importing updates by
          AccuLynx job number instead of duplicating.
        </p>
        <LoadAccuLynx />
        {error && <p className="text-sm text-destructive">{error}</p>}
        {preview && (
          <div className="flex flex-col gap-4 rounded-md border p-4">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="blue">
                {preview.total} jobs in {n}
              </Badge>
              {preview.updates > 0 && (
                <Badge variant="outline">
                  {preview.updates} already imported (will update)
                </Badge>
              )}
              {preview.links > 0 && (
                <Badge variant="outline">
                  {preview.links} match a job here by address (will link)
                </Badge>
              )}
              {preview.skipped > 0 && (
                <Badge variant="outline">
                  {preview.skipped} blank rows skipped
                </Badge>
              )}
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                First rows as read
              </summary>
              <ul className="mt-1 text-xs">
                {preview.sample.map((r) => (
                  <li key={r.row}>
                    #{r.jobNumber ?? "—"} · {r.name} ·{" "}
                    {r.address ?? "no address"} ·{" "}
                    {r.milestone || "no milestone"}
                    {r.contact &&
                      ` · ${r.contact.firstName} ${r.contact.lastName}`}
                    {r.amount != null &&
                      ` · $${r.amount.toLocaleString("en-US")}`}
                  </li>
                ))}
              </ul>
            </details>
            <MapAccuLynx
              fileUrl={f!}
              fileName={n!}
              header={preview.header}
              fields={AX_FIELD_KEYS.map((k) => ({
                key: k,
                label: AX_FIELDS[k].label,
              }))}
              map={preview.map as Record<string, number>}
              milestones={preview.milestones}
            />
          </div>
        )}
      </section>

    </div>
  );
}
