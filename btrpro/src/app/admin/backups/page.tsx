import { requireUser } from "@/lib/auth";
import { KEEP, backupDir, dbFile, listBackups, offsiteConfigured, storageUse } from "@/lib/backup";
import { Button } from "@/components/ui/button";
import { backupNowAction } from "./actions";

const size = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
const when = (d: Date) => d.toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function BackupsPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  await requireUser(["ADMIN"]);
  const { msg } = await searchParams;
  const [list, use] = await Promise.all([listBackups(), storageUse()]);
  const latest = list[0];
  const stale = !latest || Date.now() - latest.at.getTime() > 36 * 3_600_000;
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Storage &amp; backups</h1>
        <p className="text-sm text-muted-foreground">
          A full copy of the database every night after 2 AM (Central). The newest {KEEP} are kept in {backupDir()}
          {offsiteConfigured() ? ", and each one is also copied to the off-site bucket." : "."}
        </p>
      </div>
      {msg && <p className="rounded-md border bg-muted/40 p-3 text-sm">{msg}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Database", use.database != null ? size(use.database) : "—"],
          ["Uploaded files", use.uploads ? `${size(use.uploads.bytes)} · ${use.uploads.files.toLocaleString()} files` : "in the cloud bucket"],
          ["Backups", size(use.backups)],
          ["Disk free", use.disk ? `${size(use.disk.free)} of ${size(use.disk.total)}` : "—"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border px-3 py-2">
            <div className="text-xs text-muted-foreground">{k}</div>
            <div className="font-semibold">{v}</div>
          </div>
        ))}
      </div>
      {!dbFile() && <p className="text-sm">This server doesn&apos;t run on SQLite, so these backups don&apos;t apply — use the database host&apos;s backups.</p>}
      <div className={`rounded-lg border p-4 ${stale ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950" : ""}`}>
        <div className="text-sm text-muted-foreground">Last backup</div>
        <div className="text-xl font-semibold">{latest ? `${when(latest.at)} · ${size(latest.bytes)}` : "None yet"}</div>
        {stale && <div className="text-sm">{latest ? "Older than a day and a half — check the server log for “[backup] failed”." : "The first one runs tonight, or press Back up now."}</div>}
      </div>
      <form action={backupNowAction}>
        <Button type="submit">Back up now</Button>
      </form>
      {!offsiteConfigured() && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950">
          <div className="font-semibold">Backups are on the same disk as the database.</div>
          They protect against mistakes and bad updates, not against losing the disk. To keep a copy somewhere else, set up a bucket (Cloudflare R2 is cheap) and add these Railway variables: BACKUP_S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (and S3_REGION if not R2). Or download a backup now and then and keep it safe.
        </div>
      )}
      {list.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1.5">Backup</th>
              <th className="py-1.5">Taken</th>
              <th className="py-1.5 text-right">Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.name} className="border-b last:border-0">
                <td className="py-1.5 font-mono text-xs">{b.name}</td>
                <td className="py-1.5">{when(b.at)}</td>
                <td className="py-1.5 text-right">{size(b.bytes)}</td>
                <td className="py-1.5 text-right">
                  <a href={`/api/admin/backups/${b.name}`} className="text-btr-link underline">
                    Download
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <details className="rounded-lg border p-4 text-sm">
        <summary className="cursor-pointer font-medium">How to restore a backup</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Pick the backup from before the problem (the names are the date and time, Central).</li>
          <li>In Railway, open the service&apos;s shell (or use the Railway CLI: railway ssh).</li>
          <li>
            Copy it over the live database: <code className="rounded bg-muted px-1">cp /data/backups/btrpro-YYYY-MM-DD-HHMM.db /data/btrpro.db</code>
          </li>
          <li>Restart the service (Railway → Deployments → Restart). Anything entered after that backup was taken is gone, so restore only when needed.</li>
        </ol>
        <p className="mt-2 text-muted-foreground">Uploaded files (photos, PDFs) live in /data/uploads and aren&apos;t in these copies; turn on Railway volume backups for those too.</p>
      </details>
    </div>
  );
}
