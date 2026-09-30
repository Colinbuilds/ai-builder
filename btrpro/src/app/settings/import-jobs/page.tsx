import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { oauthConfigured, getConnection } from "@/lib/integrations/oauth";
import { previewSchedule, type Market } from "@/lib/import/service";
import { LoadSchedule, MapAndImport } from "@/components/import/import-forms";
import { Badge } from "@/components/ui/badge";

// BTR's live schedules in the company shared drive (links only; the app reads them with the signed-in user's Drive access).
const PRESETS = [
  {
    label: "BTR Residential Schedule (Live)",
    link: "https://docs.google.com/spreadsheets/d/1oDgUhFsbYhzh4TVv8LMg8oMq3tMSLThCmcE0yOYJrq4/edit",
  },
  {
    label: "BTR Commercial Schedule (Live)",
    link: "https://docs.google.com/spreadsheets/d/10-mta4u8yLmIsD0Y_xcqLxIjbAQjPIPeiDO_MctBwqM/edit",
  },
];
const STAGE: Record<string, string> = {
  SOLD: "Sold / upcoming",
  SCHEDULED: "Scheduled",
  IN_PRODUCTION: "In production",
  COMPLETE: "Complete",
  INVOICED: "Invoiced",
  PAID: "Paid",
};

export default async function ImportJobs({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; n?: string; m?: string }>;
}) {
  const user = await requireUser(["ADMIN"]);
  const { f, n, m } = await searchParams;
  const driveReady =
    oauthConfigured("GOOGLE_DRIVE") &&
    !!(await getConnection("GOOGLE_DRIVE", user.id));
  let preview: Awaited<ReturnType<typeof previewSchedule>> | null = null;
  let error: string | null = null;
  if (f && n && f.includes("imports/schedules")) {
    try {
      preview = await previewSchedule(
        f,
        n,
        (m === "COMMERCIAL" ? "COMMERCIAL" : "RESIDENTIAL") as Market,
      );
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Import jobs</h1>
        <p className="text-sm text-muted-foreground">
          Brings jobs from the Residential and Commercial schedules into BTRpro,
          each under its builder or customer account, so builder jobs price from
          that builder&apos;s sheets. Stage comes from the tab (Upcoming,
          Current, Completed) and the Completed / Billed / Paid columns; sell
          becomes the contract amount. Run it again any time: jobs already
          imported are matched, moved forward if the schedule shows progress,
          and never duplicated.
        </p>
      </div>
      <LoadSchedule driveReady={driveReady} presets={PRESETS} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {preview && (
        <section className="flex flex-col gap-4">
          <h2 className="font-semibold">
            2. Check the preview: {n} (
            {m === "COMMERCIAL" ? "commercial" : "residential"})
          </h2>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="blue">{preview.total} jobs found</Badge>
            {preview.alreadyImported > 0 && (
              <Badge variant="outline">
                {preview.alreadyImported} already imported
              </Badge>
            )}
            {Object.entries(preview.stages).map(([s, c]) => (
              <Badge key={s} variant="outline">
                {STAGE[s] ?? s}: {c}
              </Badge>
            ))}
            {preview.skipped > 0 && (
              <Badge variant="outline">{preview.skipped} rows skipped</Badge>
            )}
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Tabs read ({preview.tabs.filter((t) => t.used).length} of{" "}
              {preview.tabs.length})
            </summary>
            <ul className="mt-1 grid gap-1 text-xs sm:grid-cols-2">
              {preview.tabs.map((t) => (
                <li key={t.name}>
                  <span className="font-medium">{t.name}</span>:{" "}
                  {t.used ? `${t.jobs} jobs` : `skipped — ${t.reason}`}
                </li>
              ))}
            </ul>
          </details>
          {preview.skippedSample.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                Skipped rows (first {preview.skippedSample.length})
              </summary>
              <ul className="mt-1 text-xs">
                {preview.skippedSample.map((s) => (
                  <li key={s.source}>
                    {s.source}: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Sample jobs
            </summary>
            <ul className="mt-1 text-xs">
              {preview.sample.map((j) => (
                <li key={j.sources[0]}>
                  {j.account} → {j.name} · {STAGE[j.stage] ?? j.stage}
                  {j.sell != null &&
                    ` · $${j.sell.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}{" "}
                  · {j.sources[0]}
                </li>
              ))}
            </ul>
          </details>
          <h2 className="font-semibold">3. Match accounts and import</h2>
          <p className="text-sm text-muted-foreground">
            Each name in the schedule&apos;s Builder column is matched to an
            account. Subdivision names are fine (&quot;DR Horton Westbrook
            Hills&quot; → DR Horton). Pick a different account or create one
            where it&apos;s wrong. Builder settings (pricing sheets, PO rules)
            live on the{" "}
            <Link className="underline" href="/builders">
              Builders
            </Link>{" "}
            page.
          </p>
          <MapAndImport
            fileUrl={f!}
            fileName={n!}
            market={m === "COMMERCIAL" ? "COMMERCIAL" : "RESIDENTIAL"}
            rows={preview.accounts}
            choices={preview.accountChoices}
          />
        </section>
      )}
    </div>
  );
}
