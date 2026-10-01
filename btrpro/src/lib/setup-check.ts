import "server-only";

// Reads which server settings (Railway variables) are present and sane — never their values.
export type Check = { name: string; status: "ok" | "missing" | "problem" | "optional"; what: string; fix?: string };

const has = (k: string) => !!process.env[k]?.trim();
const pair = (id: string, secret: string, label: string, how: string): Check => {
  const a = has(id);
  const b = has(secret);
  if (a && b) return { name: label, status: "ok", what: `${id} and ${secret} are set.` };
  if (!a && !b) return { name: label, status: "optional", what: "Not set up.", fix: how };
  return { name: label, status: "problem", what: `${a ? secret : id} is missing — one without the other does nothing.`, fix: how };
};

export function setupChecks(): Check[] {
  const app = process.env.APP_URL?.trim() ?? "";
  const out: Check[] = [];
  out.push(
    !app
      ? { name: "Site address (APP_URL)", status: "missing", what: "Not set. Links in emails, QuickBooks and Google sign-in need it.", fix: "Set APP_URL to the site's address, e.g. https://btrpro.up.railway.app (no slash at the end)." }
      : !app.startsWith("https://") || app.endsWith("/")
        ? { name: "Site address (APP_URL)", status: "problem", what: "Should start with https:// and have no slash at the end.", fix: `Change it to ${app.replace(/\/+$/, "").replace(/^http:\/\//, "https://")}` }
        : { name: "Site address (APP_URL)", status: "ok", what: app },
  );
  out.push(has("AUTH_SECRET") ? { name: "Login security (AUTH_SECRET)", status: "ok", what: "Set." } : { name: "Login security (AUTH_SECRET)", status: "missing", what: "Not set.", fix: "Set AUTH_SECRET to a long random string." });
  if (process.env.RESET_ADMIN_PASSWORD === "true")
    out.push({ name: "RESET_ADMIN_PASSWORD", status: "problem", what: "Still set — the admin password is reset on every deploy.", fix: "Delete this variable in Railway." });
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  const tok = process.env.ANTHROPIC_AUTH_TOKEN?.trim();
  out.push(
    key
      ? key.startsWith("sk-ant-api")
        ? { name: "AI (ANTHROPIC_API_KEY)", status: "ok", what: "API key set." }
        : { name: "AI (ANTHROPIC_API_KEY)", status: "problem", what: "Doesn't look like an API key (they start sk-ant-api).", fix: "Paste the key from console.anthropic.com → API Keys." }
      : tok?.startsWith("sk-ant-api")
        ? { name: "AI (ANTHROPIC_API_KEY)", status: "problem", what: "An API key is in ANTHROPIC_AUTH_TOKEN, which sends it the wrong way and gets rejected.", fix: "Rename the variable to ANTHROPIC_API_KEY." }
        : tok
          ? { name: "AI (ANTHROPIC_API_KEY)", status: "problem", what: "Only ANTHROPIC_AUTH_TOKEN is set. Use an API key instead.", fix: "console.anthropic.com → API Keys → Create Key; set ANTHROPIC_API_KEY; remove ANTHROPIC_AUTH_TOKEN." }
          : { name: "AI (ANTHROPIC_API_KEY)", status: "missing", what: "Not set — receipt reading, directory import, plan review and the assistant are off.", fix: "console.anthropic.com → API Keys → Create Key; set ANTHROPIC_API_KEY." },
  );
  const drv = process.env.STORAGE_DRIVER ?? "local";
  if (drv === "s3") {
    const miss = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter((k) => !has(k));
    out.push(
      miss.length
        ? { name: "File storage (S3)", status: "problem", what: `Missing ${miss.join(", ")} — uploads will fail.`, fix: "Cloudflare R2: S3_ENDPOINT = https://<account id>.r2.cloudflarestorage.com, S3_BUCKET = bucket name, S3_REGION = auto, plus the R2 access key pair." }
        : { name: "File storage (S3)", status: has("S3_ENDPOINT") || has("S3_REGION") ? "ok" : "problem", what: has("S3_ENDPOINT") ? `Bucket ${process.env.S3_BUCKET} at a custom endpoint.` : `Bucket ${process.env.S3_BUCKET} on AWS (${process.env.S3_REGION ?? "no region"}).`, fix: has("S3_ENDPOINT") || has("S3_REGION") ? undefined : "Set S3_REGION (or S3_ENDPOINT for R2)." },
    );
  } else out.push({ name: "File storage", status: "problem", what: `STORAGE_DRIVER is "${drv}" — files are kept on the server's disk and are lost on redeploy unless a Railway volume is mounted.`, fix: "Use an S3-compatible bucket (Cloudflare R2 is cheapest) and set STORAGE_DRIVER=s3, or mount a Railway volume." });
  out.push(pair("QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QuickBooks Online", `developer.intuit.com → your app → Keys & credentials (Production). Redirect URI: ${app || "APP_URL"}/api/integrations/quickbooks/callback`));
  out.push(pair("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "Google Drive sign-in", `console.cloud.google.com → Credentials → OAuth client. Redirect URI: ${app || "APP_URL"}/api/integrations/google_drive/callback`));
  out.push(pair("MS_CLIENT_ID", "MS_CLIENT_SECRET", "Microsoft 365 mailbox", "Azure portal → App registrations → your app (Application ID + a client secret)."));
  out.push(pair("EAGLEVIEW_CLIENT_ID", "EAGLEVIEW_CLIENT_SECRET", "EagleView", "From EagleView's developer program."));
  out.push(pair("ABC_CLIENT_ID", "ABC_CLIENT_SECRET", "ABC Supply", "From ABC Supply's API program."));
  out.push(has("GOOGLE_MAPS_API_KEY") ? { name: "Exact address lookup", status: "ok", what: "Google Places key set." } : { name: "Exact address lookup", status: "optional", what: "Using free OpenStreetMap suggestions (check ZIPs).", fix: "Enable Places API (New) in Google Cloud, create an API key, set GOOGLE_MAPS_API_KEY." });
  out.push(has("POSTMARK_SERVER_TOKEN") ? { name: "Sending email", status: "ok", what: "Postmark token set." } : { name: "Sending email", status: "optional", what: "Not set — proposal and invoice links are copied by hand.", fix: "postmarkapp.com → server → API token; set POSTMARK_SERVER_TOKEN and EMAIL_FROM." });
  out.push(
    has("TWILIO_ACCOUNT_SID") && has("TWILIO_AUTH_TOKEN") && has("TWILIO_FROM_NUMBER")
      ? { name: "Texts to project managers", status: "ok", what: "Twilio set." }
      : { name: "Texts to project managers", status: "optional", what: "Not set — PM crew alerts show in the app only.", fix: "Twilio: buy a number, register it for US business texting (A2P 10DLC), set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER." },
  );
  out.push(has("STRIPE_SECRET_KEY") ? { name: "Card payments", status: "ok", what: "Stripe set." } : { name: "Card payments", status: "optional", what: "Not set — invoices take check/ACH only.", fix: "Stripe → Developers → API keys; set STRIPE_SECRET_KEY and the webhook secret." });
  return out;
}
