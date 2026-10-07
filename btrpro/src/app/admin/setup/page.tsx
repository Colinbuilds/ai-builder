import { requireUser } from "@/lib/auth";
import { setupChecks, type Check } from "@/lib/setup-check";
import { dbFile, listBackups, offsiteConfigured } from "@/lib/backup";

const STYLE = {
  ok: ["✓", "text-green-700 dark:text-green-400"],
  missing: ["✗", "text-red-600"],
  problem: ["!", "text-amber-700 dark:text-amber-400"],
  optional: ["–", "text-muted-foreground"],
} as const;

export default async function SetupPage() {
  await requireUser(["ADMIN"]);
  const checks = setupChecks();
  if (dbFile() && process.env.NODE_ENV === "production") {
    const latest = (await listBackups())[0];
    const fresh = latest && Date.now() - latest.at.getTime() < 36 * 3_600_000;
    const c: Check = !fresh
      ? { name: "Backups", status: "missing", what: latest ? "The last backup is more than a day and a half old." : "No backup yet.", fix: "Settings → Backups → Back up now, and check the server log for “[backup] failed”." }
      : offsiteConfigured()
        ? { name: "Backups", status: "ok", what: "Nightly, kept 14 days, copied off-site." }
        : { name: "Backups", status: "problem", what: "Nightly, kept 14 days — but only on the same disk as the database.", fix: "Add an off-site bucket: BACKUP_S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (Cloudflare R2 works)." };
    checks.push(c);
  }
  const order = { missing: 0, problem: 1, optional: 2, ok: 3 };
  checks.sort((a, b) => order[a.status] - order[b.status]);
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Setup check</h1>
        <p className="text-sm text-muted-foreground">
          What&apos;s configured on the server (Railway → your service → Variables). Values are never shown here. After changing a variable, Railway redeploys;
          reload this page to re-check.
        </p>
      </div>
      <ul className="divide-y rounded-md border text-sm">
        {checks.map((c) => (
          <li key={c.name} className="grid grid-cols-[24px_1fr] gap-2 px-3 py-2.5">
            <span className={`font-bold ${STYLE[c.status][1]}`}>{STYLE[c.status][0]}</span>
            <div className="min-w-0">
              <div className="font-medium">{c.name}</div>
              <div className="text-muted-foreground">{c.what}</div>
              {c.fix && <div className="mt-0.5">{c.fix}</div>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
