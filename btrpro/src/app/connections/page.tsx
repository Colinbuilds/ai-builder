import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { OAUTH, oauthConfigured, redirectUri, type OAuthProvider } from "@/lib/integrations/oauth";
import { serviceAccountEmail } from "@/lib/integrations/google-sa";
import { AbcSyncButton } from "@/components/connections/sync-button";
import { abcAccountAction, disconnectAction } from "./actions";
import { appName, shortName } from "@/lib/company-profile";

const when = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never";
const usd = (n: number | null) => (n == null ? "" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));

type Card = { p: OAuthProvider; name: string; reads: string; keys: string[]; ask: string };
const CARDS: Card[] = [
  {
    p: "ABC_SUPPLY",
    name: "ABC Supply",
    reads: `Order history and invoices for ${shortName()}'s account, every 30 minutes, matched to jobs by PO number or job name.`,
    keys: ["ABC_CLIENT_ID", "ABC_CLIENT_SECRET"],
    ask: `Register ${appName()} at apidocs.abcsupply.com (or ask Michael Poe for API access) to get the client ID and secret.`,
  },
  {
    p: "EAGLEVIEW",
    name: "EagleView",
    reads: `Report orders and finished reports once EagleView issues ${shortName()}'s API access.`,
    keys: ["EAGLEVIEW_CLIENT_ID", "EAGLEVIEW_CLIENT_SECRET", "EAGLEVIEW_AUTH_URL", "EAGLEVIEW_TOKEN_URL"],
    ask: "Request API access at developer.eagleview.com (or Integrations@EagleView.com). They send the client ID, secret and sign-in addresses.",
  },
  {
    p: "QUICKBOOKS",
    name: "QuickBooks Online",
    reads: "Customers, invoices, payments, bills, and a QuickBooks number for each new job.",
    keys: ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET"],
    ask: "Create an app at developer.intuit.com (QuickBooks Online and Payments, Accounting scope).",
  },
  {
    p: "PROCORE",
    name: "Procore",
    reads: `Change orders, RFIs and submittals on GC projects ${shortName()} is added to.`,
    keys: ["PROCORE_CLIENT_ID", "PROCORE_CLIENT_SECRET"],
    ask: "Create an app at developers.procore.com.",
  },
];

export default async function Connections({ searchParams }: { searchParams: Promise<{ connected?: string }> }) {
  const user = await requireUser(["ADMIN", "OFFICE", "PURCHASING"]);
  const admin = user.role === "ADMIN";
  const sp = await searchParams;
  const [conns, s, feed, feedCount] = await Promise.all([
    prisma.integrationConnection.findMany({ where: { userId: null } }),
    getSettings(),
    prisma.supplierFeed.findMany({ where: { provider: "ABC_SUPPLY" }, orderBy: [{ date: { sort: "desc", nulls: "last" } }], take: 40 }),
    prisma.supplierFeed.groupBy({ by: ["kind"], where: { provider: "ABC_SUPPLY" }, _count: true }),
  ]);
  const jobs = new Map((await prisma.project.findMany({ where: { id: { in: feed.map((f) => f.projectId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((j) => [j.id, j.name]));
  const conn = (p: OAuthProvider) => conns.find((c) => c.provider === p);
  const count = (k: string) => feedCount.find((f) => f.kind === k)?._count ?? 0;

  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Connections</h1>
        <p className="text-sm text-muted-foreground">
          Press <b>Connect</b> and sign in on the company&apos;s own page (ABC, EagleView, QuickBooks). {appName()} never sees or stores the password — it gets a key that keeps it signed in and reads your data in the background. Disconnect any time.
        </p>
      </div>
      {sp.connected && (
        <p className={`rounded-md p-3 text-sm ${sp.connected === "denied" ? "bg-amber-50 text-amber-900" : "bg-green-50 text-green-800"}`}>
          {sp.connected === "denied" ? "Sign-in was cancelled." : `Connected: ${sp.connected}.`}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {CARDS.map((c) => {
          const ready = oauthConfigured(c.p);
          const on = conn(c.p);
          return (
            <section key={c.p} className="flex flex-col gap-2 rounded-lg border bg-background p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">{c.name}</h2>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${on ? "bg-green-100 text-green-800" : ready ? "bg-btr-blue-soft text-btr-blue-dark" : "bg-muted text-muted-foreground"}`}>
                  {on ? "Connected" : ready ? "Ready to connect" : "Needs setup"}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{c.reads}</p>
              {on ? (
                <>
                  <p className="text-xs text-muted-foreground">Connected {when(on.createdAt)} · stays signed in automatically</p>
                  {c.p === "ABC_SUPPLY" && (
                    <>
                      <p className="text-sm">
                        Last read {when(s.abcSyncedAt)} · {count("ORDER")} orders · {count("INVOICE")} invoices
                      </p>
                      {s.abcSyncError && <p className="text-sm text-red-700">{s.abcSyncError}</p>}
                      <AbcSyncButton />
                      {admin && (
                        <form action={abcAccountAction} className="flex items-center gap-2 text-sm">
                          <label className="flex items-center gap-2">
                            Bill-to account #
                            <input name="billTo" defaultValue={s.abcBillTo ?? ""} placeholder="for invoices" className="h-8 w-36 rounded-md border border-input bg-background px-2" />
                          </label>
                          <button className="h-8 rounded-md border px-2 hover:bg-muted">Save</button>
                        </form>
                      )}
                    </>
                  )}
                  {admin && (
                    <form action={disconnectAction}>
                      <input type="hidden" name="provider" value={c.p} />
                      <button className="text-xs text-red-700 hover:underline">Disconnect {c.name}</button>
                    </form>
                  )}
                </>
              ) : ready ? (
                admin ? (
                  <a href={`/api/integrations/${c.p.toLowerCase()}/start?returnTo=/connections`} className="self-start rounded-md bg-btr-blue px-4 py-2 text-sm font-medium text-white hover:bg-btr-blue-dark">
                    Connect {c.name} — sign in
                  </a>
                ) : (
                  <p className="text-sm text-muted-foreground">An Admin connects this once for the company.</p>
                )
              ) : (
                <div className="text-sm">
                  <p className="text-muted-foreground">{c.ask}</p>
                  {admin && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Then add in Railway: {c.keys.join(", ")}
                      {process.env.APP_URL ? (
                        <>
                          {" "}
                          · sign-in return address: <code className="break-all">{redirectUri(c.p)}</code>
                        </>
                      ) : (
                        " · and APP_URL"
                      )}
                    </p>
                  )}
                </div>
              )}
            </section>
          );
        })}
        <section className="flex flex-col gap-2 rounded-lg border bg-background p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Google Drive</h2>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${serviceAccountEmail() ? "bg-green-100 text-green-800" : "bg-muted text-muted-foreground"}`}>{serviceAccountEmail() ? "Connected" : "Needs setup"}</span>
          </div>
          <p className="text-sm text-muted-foreground">Price sheets, the estimating and production schedules, plans and CompanyCam photos. Share a folder or sheet with the service account to let {appName()} read it.</p>
          {serviceAccountEmail() && <p className="text-xs break-all text-muted-foreground">Reads as {serviceAccountEmail()}</p>}
        </section>
      </div>

      {conn("ABC_SUPPLY") && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">Latest from ABC Supply</h2>
          {feed.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet — press Sync now.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border bg-background">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5">Date</th>
                    <th className="px-2 py-1.5">Type</th>
                    <th className="px-2 py-1.5">#</th>
                    <th className="px-2 py-1.5">PO / job name</th>
                    <th className="px-2 py-1.5">Status / branch</th>
                    <th className="px-2 py-1.5 text-right">Total</th>
                    <th className="px-2 py-1.5">{appName()} job</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {feed.map((f) => (
                    <tr key={f.id}>
                      <td className="px-2 py-1.5 text-xs tabular-nums">{f.date ? f.date.toLocaleDateString("en-US", { timeZone: "UTC" }) : ""}</td>
                      <td className="px-2 py-1.5 text-xs">{f.kind === "ORDER" ? "Order" : "Invoice"}</td>
                      <td className="px-2 py-1.5 text-xs">{f.number}</td>
                      <td className="px-2 py-1.5 text-xs">{[f.poNumber, f.jobName].filter(Boolean).join(" · ")}</td>
                      <td className="px-2 py-1.5 text-xs">{[f.status, f.branch].filter(Boolean).join(" · ")}</td>
                      <td className="px-2 py-1.5 text-right text-xs tabular-nums">{usd(f.total)}</td>
                      <td className="px-2 py-1.5 text-xs">
                        {f.projectId ? (
                          <Link href={`/projects/${f.projectId}`} className="text-btr-link hover:underline">
                            {jobs.get(f.projectId) ?? "Job"}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">no match</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        Sites without a sign-in connection (like a supplier portal with no API) can&apos;t be read automatically — forward their emails to the job&apos;s address or upload the PDF. Each connection reads only what that company lets {shortName()}&apos;s account share. {OAUTH.ABC_SUPPLY.label} sign-ins refresh every 30 minutes, so they don&apos;t expire.
      </p>
    </div>
  );
}
