import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { databasePersistence } from "@/lib/setup-check";
import { serviceAccountEmail } from "@/lib/integrations/google-sa";
import { DEFAULT_JOBS_DRIVE, driveImportSummary } from "@/lib/import/drive-jobs";
import { DriveScanButton, ReprintAllButton } from "@/components/connections/drive-scan";
import { retryAction, runAction, settingsAction, skipAction } from "./actions";
import { appName, shortName } from "@/lib/company-profile";

const gb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);
const STATUS: Record<string, string> = { PENDING: "Waiting", DONE: "Moved", ERROR: "Problem", SKIPPED: "Skipped" };

export default async function DriveJobs({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const [s, sum] = await Promise.all([getSettings(), driveImportSummary()]);
  const show = ["PENDING", "DONE", "ERROR", "SKIPPED"].includes(sp.show ?? "") ? sp.show! : undefined;
  const rows = await prisma.driveJobFolder.findMany({ where: show ? { status: show } : {}, orderBy: { modifiedAt: { sort: "desc", nulls: "last" } }, take: 300 });
  const jobs = new Map((await prisma.project.findMany({ where: { id: { in: rows.map((r) => r.projectId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((j) => [j.id, j.name]));
  const db = databasePersistence();
  const unsafe = !!db && !db.persistent && process.env.STORAGE_DRIVER !== "s3";
  const total = sum.pending + sum.done + sum.error + sum.skipped;
  // rough pace: ~1.5 s per file (download + text read) on the server
  const hoursLeft = sum.files ? Math.max(0.1, ((sum.files - sum.copied) * 1.5) / 3600) : 0;

  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Move jobs from Drive</h1>
        <p className="text-sm text-muted-foreground">
          Every job folder in the jobs Drive becomes a {appName()} job (or joins the one that already exists), and every file in it is copied into that job&apos;s Documents with its folder path. Drive is only read — nothing there is moved, renamed or deleted.
        </p>
      </div>

      {!serviceAccountEmail() && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">Google Drive isn&apos;t connected (service account). Set it up on Connections first.</p>}
      {unsafe && (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          <b>Can&apos;t start yet:</b> files would be copied onto the server&apos;s temporary disk and lost on the next deploy. Add the Railway volume at <code>/data</code> first (see Setup check) — or S3/R2 storage for very large plan sets.
        </p>
      )}

      <section className="flex flex-col gap-3 rounded-lg border bg-background p-4">
        <form action={settingsAction} className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            Jobs Drive (shared drive or folder link)
            <input name="drive" defaultValue={s.jobsDriveId ?? ""} placeholder={`${shortName()} jobs drive (${DEFAULT_JOBS_DRIVE})`} className="h-9 w-80 rounded-md border border-input bg-background px-2" />
          </label>
          <label className="flex flex-col gap-1">
            Jobs from the last
            <select name="months" defaultValue={String(s.driveImportMonths ?? 12)} className="h-9 rounded-md border border-input bg-background px-2">
              {[3, 6, 9, 12, 18, 24].map((m) => (
                <option key={m} value={m}>
                  {m} months
                </option>
              ))}
            </select>
          </label>
          <button className="h-9 rounded-md border px-3 hover:bg-muted">Save</button>
        </form>
        <div className="flex flex-wrap items-center gap-3">
          <DriveScanButton />
          <form action={runAction}>
            <input type="hidden" name="on" value={s.driveImportOn ? "0" : "1"} />
            <button disabled={!total || (unsafe && !s.driveImportOn)} className={`h-9 rounded-md px-4 text-sm font-medium disabled:opacity-50 ${s.driveImportOn ? "border hover:bg-muted" : "bg-btr-blue text-white hover:bg-btr-blue-dark"}`}>
              {s.driveImportOn ? "Pause the move" : "2. Start moving jobs"}
            </button>
          </form>
          {s.driveImportScannedAt && <span className="text-xs text-muted-foreground">Last scan {new Date(s.driveImportScannedAt).toLocaleString("en-US", { timeZone: "America/Chicago" })}</span>}
        </div>
        {total > 0 && (
          <div className="grid gap-2 text-sm sm:grid-cols-5">
            <Stat label="Job folders" v={String(total)} />
            <Stat label="Files" v={`${sum.copied.toLocaleString()} of ${sum.files.toLocaleString()} copied`} />
            <Stat label="Size" v={gb(sum.bytes)} />
            <Stat label="Moved / waiting / problems" v={`${sum.done} / ${sum.pending} / ${sum.error}`} />
            <Stat label="Time left (est.)" v={sum.pending ? `~${hoursLeft < 1 ? `${Math.round(hoursLeft * 60)} min` : `${hoursLeft.toFixed(1)} hours`}` : "done"} />
          </div>
        )}
        {sum.done > 0 && <ReprintAllButton />}
        <p className="text-xs text-muted-foreground">
          Runs in the background a few folders a minute while switched on — you can close this page. Once everything is moved it re-checks Drive nightly and copies any new jobs or files, until you pause it.
        </p>
      </section>

      {total > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {[undefined, "PENDING", "DONE", "ERROR", "SKIPPED"].map((k) => (
              <Link key={k ?? "all"} href={k ? `/settings/drive-jobs?show=${k}` : "/settings/drive-jobs"} className={`rounded-md px-2 py-1 ${show === k ? "bg-btr-blue text-white" : "hover:bg-muted"}`}>
                {k ? STATUS[k] : "All"}
              </Link>
            ))}
            {sum.error > 0 && (
              <form action={retryAction} className="ml-auto">
                <button className="h-8 rounded-md border px-3 hover:bg-muted">Retry all problems</button>
              </form>
            )}
          </div>
          <div className="overflow-x-auto rounded-md border bg-background">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5">Drive folder</th>
                  <th className="px-2 py-1.5">Files</th>
                  <th className="px-2 py-1.5">Status</th>
                  <th className="px-2 py-1.5">{appName()} job</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-2 py-1.5">
                      <a href={`https://drive.google.com/drive/folders/${r.folderId}`} target="_blank" rel="noreferrer" className="text-btr-link hover:underline">
                        {r.name}
                      </a>
                      {r.modifiedAt && <div className="text-xs text-muted-foreground">changed {r.modifiedAt.toLocaleDateString("en-US")}</div>}
                    </td>
                    <td className="px-2 py-1.5 text-xs tabular-nums">
                      {r.filesAdded}/{r.fileCount ?? "?"} · {gb(r.totalBytes ?? 0)}
                    </td>
                    <td className="px-2 py-1.5 text-xs">
                      {STATUS[r.status] ?? r.status}
                      {Array.isArray(r.errors) && r.errors.length > 0 && (
                        <details>
                          <summary className="cursor-pointer text-red-700">{r.errors.length} problem{r.errors.length === 1 ? "" : "s"}</summary>
                          <ul className="list-disc pl-4 text-muted-foreground">
                            {(r.errors as string[]).slice(0, 10).map((e, i) => (
                              <li key={i}>{e}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-xs">
                      {r.projectId ? (
                        <Link href={`/projects/${r.projectId}`} className="text-btr-link hover:underline">
                          {jobs.get(r.projectId) ?? "Job"}
                        </Link>
                      ) : (
                        "—"
                      )}
                      {r.matchedBy && <div className="text-muted-foreground">{r.matchedBy}</div>}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex gap-1">
                        <form action={retryAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <button disabled={unsafe} className="h-7 rounded-md border px-2 text-xs hover:bg-muted disabled:opacity-50">
                            Move now
                          </button>
                        </form>
                        <form action={skipAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <button className="h-7 rounded-md border px-2 text-xs hover:bg-muted">{r.status === "SKIPPED" ? "Include" : "Skip"}</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{v}</div>
    </div>
  );
}
