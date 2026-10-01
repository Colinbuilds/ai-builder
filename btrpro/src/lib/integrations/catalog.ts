// What each integration does, what it needs, and its status. Shown on Settings → Integrations.
import { prisma } from "@/lib/db";
import { aiConfigured } from "@/lib/ai/claude";
import { providerConfigured } from "@/lib/comms/mailbox";
import { oauthConfigured, type OAuthProvider } from "./oauth";
import { serviceAccountEmail, serviceAccountProblem } from "./google-sa";

export type IntegrationStatus = "connected" | "ready" | "not_configured" | "manual_only";
export type Integration = {
  key: string;
  name: string;
  does: string;
  needs: string[];
  fallback: string;
  status: IntegrationStatus;
  statusText: string;
  connectUrl?: string;
  note?: string;
};

const env = (...names: string[]) => names.every((n) => !!process.env[n]);

export async function integrationCatalog(userId: string): Promise<Integration[]> {
  const conns = await prisma.integrationConnection.findMany({ where: { OR: [{ userId }, { userId: null }] } });
  const has = (p: OAuthProvider) => conns.some((c) => c.provider === p);
  const oauth = (p: OAuthProvider, who: string): Pick<Integration, "status" | "statusText" | "connectUrl"> =>
    !oauthConfigured(p)
      ? { status: "not_configured", statusText: "Server keys not set" }
      : has(p)
        ? { status: "connected", statusText: `Connected (${who})` }
        : { status: "ready", statusText: "Ready to connect", connectUrl: `/api/integrations/${p.toLowerCase()}/start?returnTo=/settings/integrations` };
  const mailboxes = await prisma.mailboxConnection.count();

  return [
    {
      key: "anthropic",
      name: "BTRbot (Claude AI)",
      does: "Reads EagleView reports and plans, summarizes job email, writes catch-ups, and powers the estimator assistant. It never does the math and never invents prices.",
      needs: ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL (default claude-opus-5-5)"],
      fallback: "Enter measurements and notes by hand; BTRbot buttons are disabled.",
      status: aiConfigured() ? "connected" : "not_configured",
      statusText: aiConfigured() ? "Configured" : "ANTHROPIC_API_KEY not set",
    },
    {
      key: "inbound",
      name: "Job email forwarding",
      does: "Each job's own address; mail sent or CC'd to it lands on the job with attachments.",
      needs: ["INBOUND_EMAIL_DOMAIN", "INBOUND_EMAIL_WEBHOOK_SECRET", "An inbound email provider (e.g. Postmark) posting to /api/inbound-email"],
      fallback: "Paste emails onto the job.",
      status: env("INBOUND_EMAIL_DOMAIN", "INBOUND_EMAIL_WEBHOOK_SECRET") ? "connected" : "not_configured",
      statusText: env("INBOUND_EMAIL_DOMAIN", "INBOUND_EMAIL_WEBHOOK_SECRET") ? `Receiving at *@${process.env.INBOUND_EMAIL_DOMAIN}` : "Not configured",
    },
    {
      key: "mailbox",
      name: "Gmail / Microsoft 365",
      does: "Each user connects their own mailbox (read-only) to pull a job's email by claim #, address, or job #.",
      needs: ["APP_URL", "GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET and/or MS_CLIENT_ID + MS_CLIENT_SECRET"],
      fallback: "Forwarding address or paste.",
      status: providerConfigured("GOOGLE") || providerConfigured("MICROSOFT") ? (mailboxes ? "connected" : "ready") : "not_configured",
      statusText:
        providerConfigured("GOOGLE") || providerConfigured("MICROSOFT")
          ? `${mailboxes} mailbox${mailboxes === 1 ? "" : "es"} connected (users connect from a job's Email tab)`
          : "Server keys not set",
    },
    {
      key: "drive",
      name: "Google Drive",
      does: "Price-sheet sync from the Current folder, job-schedule import, and plans/specs/reports/photos into a job from a file or folder link.",
      needs: ["Recommended: GOOGLE_SERVICE_ACCOUNT_JSON (a service account key, Drive API enabled) and share the folders with its email", "Or per user: APP_URL + GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET"],
      fallback: "Upload files directly.",
      ...(serviceAccountEmail()
        ? { status: "connected" as const, statusText: "Company service account" }
        : serviceAccountProblem()
          ? { status: "not_configured" as const, statusText: "Service account key can't be read" }
          : oauth("GOOGLE_DRIVE", "you")),
      note: serviceAccountEmail()
        ? `BTRpro reads Drive as ${serviceAccountEmail()}. Share each folder or shared drive it should read with that address (Viewer).`
        : serviceAccountProblem()
          ? `GOOGLE_SERVICE_ACCOUNT_JSON is set, but: ${serviceAccountProblem()}`
          : process.env.GOOGLE_SERVICE_ACCOUNT_JSON === undefined
            ? "GOOGLE_SERVICE_ACCOUNT_JSON isn't reaching the app — check the variable is on the BTRpro service (not the project's shared variables only) and spelled exactly, then redeploy."
            : "Without a service account, each user connects their own Drive and the price-sheet sync runs as the Admin who saved the folder.",
    },
    {
      key: "quickbooks",
      name: "QuickBooks Online",
      does: "Sync customers, invoices, payments, and vendor bills; bring actual job costs into job costing.",
      needs: ["APP_URL", "QBO_CLIENT_ID", "QBO_CLIENT_SECRET (Intuit developer app)", "An Admin connects BTR's company once"],
      fallback: "CSV export/import.",
      ...oauth("QUICKBOOKS", "company"),
      note: "Invoice and bill sync is built with job costing and invoicing.",
    },
    {
      key: "procore",
      name: "Procore (commercial GCs)",
      does: "Link a job to the GC's Procore project and pull change orders, RFIs, submittals, and schedule dates.",
      needs: ["APP_URL", "PROCORE_CLIENT_ID", "PROCORE_CLIENT_SECRET (Procore developer app)", "The GC adds BTR to their project"],
      fallback: "Forward or upload CO/RFI PDFs to the job.",
      ...oauth("PROCORE", "company"),
      note: "Change-order sync is built with change orders.",
    },
    {
      key: "buildertrend",
      name: "Buildertrend (residential builders)",
      does: "Pull builder change orders and schedules for new-construction jobs.",
      needs: ["API or partner access from Buildertrend for BTR's account"],
      fallback: "Forward the builder's CO notifications to the job's email address, or upload the PDFs.",
      status: "manual_only",
      statusText: "Needs partner access from Buildertrend",
      note: "I couldn't confirm a public Buildertrend API that a subcontractor can build against. If Buildertrend grants BTR access, it plugs in here like Procore.",
    },
    {
      key: "eagleview",
      name: "EagleView",
      does: "Order roof and walls reports from the job and receive them automatically, then read them with BTRbot.",
      needs: ["EagleView API credentials for BTR's account (EAGLEVIEW_CLIENT_ID / EAGLEVIEW_CLIENT_SECRET)"],
      fallback: "Upload the EagleView PDF to the job's Documents tab; it's read and queued for confirmation.",
      status: env("EAGLEVIEW_CLIENT_ID", "EAGLEVIEW_CLIENT_SECRET") ? "ready" : "manual_only",
      statusText: env("EAGLEVIEW_CLIENT_ID", "EAGLEVIEW_CLIENT_SECRET") ? "Credentials set" : "Upload reports for now",
      note: "Ordering needs EagleView to issue API credentials to BTR.",
    },
    {
      key: "abc",
      name: "ABC Supply (myABCsupply)",
      does: "Branch #112 pricing and items, place orders from the estimate, track orders and deliveries, and import invoices into job costing.",
      needs: ["API access granted by ABC Supply for BTR's account (ABC_CLIENT_ID / ABC_CLIENT_SECRET)"],
      fallback: "Price-sheet upload (Sheets), emailed/PDF orders, invoice CSV import.",
      status: env("ABC_CLIENT_ID", "ABC_CLIENT_SECRET") ? "ready" : "manual_only",
      statusText: env("ABC_CLIENT_ID", "ABC_CLIENT_SECRET") ? "Credentials set" : "Price sheets and CSV for now",
      note: "Ordering is built with the materials module; ask your ABC rep (Michael Poe) about API access.",
    },
    {
      key: "companycam",
      name: "CompanyCam",
      does: "Show each job's CompanyCam photos on the job.",
      needs: ["COMPANYCAM_TOKEN (CompanyCam API access token)"],
      fallback: "Upload photos to the job.",
      status: env("COMPANYCAM_TOKEN") ? "ready" : "not_configured",
      statusText: env("COMPANYCAM_TOKEN") ? "Token set" : "Token not set",
    },
    {
      key: "storage",
      name: "File storage",
      does: "Where uploaded documents live.",
      needs: ["STORAGE_DRIVER=s3 with S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (+ S3_ENDPOINT for R2/B2) in production"],
      fallback: "Local disk (development only).",
      status: process.env.STORAGE_DRIVER === "s3" ? "connected" : "not_configured",
      statusText: process.env.STORAGE_DRIVER === "s3" ? `S3 bucket ${process.env.S3_BUCKET ?? "(not set)"}` : "Local disk (dev only)",
    },
  ];
}
