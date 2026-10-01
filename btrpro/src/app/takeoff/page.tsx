import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";

const SHEETS = /\.(pdf|png|jpe?g|webp)$/i;
const when = (d: Date) => d.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" });

/** Blueprint measurer: every job's plan sheets in one place, newest work first. */
export default async function BlueprintMeasurer({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser();
  const q = (await searchParams).q?.trim() ?? "";
  const docs = await prisma.document.findMany({
    where: q
      ? { OR: [{ project: { name: { contains: q } } }, { project: { address: { contains: q } } }, { fileName: { contains: q } }] }
      : { project: { status: { notIn: ["CLOSED", "LOST", "PAID"] } } },
    orderBy: { uploadedAt: "desc" },
    take: 400,
    select: { id: true, fileName: true, type: true, pages: true, uploadedAt: true, project: { select: { id: true, name: true, address: true } } },
  });
  const sheets = docs.filter((d) => SHEETS.test(d.fileName));
  const takeoffs = await prisma.planTakeoff.findMany({
    where: { documentId: { in: sheets.map((d) => d.id) } },
    select: { documentId: true, page: true, items: true, savedToJob: true, updatedAt: true },
  });
  const jobs = new Map<string, { job: (typeof sheets)[number]["project"]; sheets: typeof sheets; last: Date }>();
  for (const d of sheets) {
    const j = jobs.get(d.project.id) ?? { job: d.project, sheets: [], last: d.uploadedAt };
    j.sheets.push(d);
    const t = takeoffs.filter((x) => x.documentId === d.id).map((x) => x.updatedAt);
    for (const x of [d.uploadedAt, ...t]) if (x > j.last) j.last = x;
    jobs.set(d.project.id, j);
  }
  const list = [...jobs.values()].sort((a, b) => b.last.getTime() - a.last.getTime());
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Blueprint measurer</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Pick a plan sheet, set the scale on a printed dimension, check it on a second one, then trace. Totals go to the job&apos;s measurements. Plan files
          are uploaded on each job&apos;s Documents tab.
        </p>
      </div>
      <form className="flex max-w-xl gap-2">
        <input name="q" defaultValue={q} placeholder="Search job name, address or file name" className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm" />
        <button className="h-9 rounded-md border px-3 text-sm hover:bg-muted">Search</button>
        {q && (
          <Link href="/takeoff" className="self-center text-sm text-muted-foreground hover:underline">
            clear
          </Link>
        )}
      </form>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {q ? "No plan sheets match." : "No open jobs have plan files yet."} Upload a plan set (PDF) or sheet images on a job&apos;s Documents tab.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map(({ job, sheets: s }) => (
            <section key={job.id} className="rounded-md border">
              <div className="flex flex-wrap items-baseline gap-x-3 border-b bg-muted/40 px-3 py-2">
                <Link href={`/projects/${job.id}/takeoff`} className="font-semibold text-btr-link hover:underline">
                  {job.name}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {job.address}
                </span>
                <Link href={`/projects/${job.id}/documents`} className="ml-auto text-xs text-muted-foreground hover:underline">
                  add plans
                </Link>
              </div>
              <ul className="divide-y text-sm">
                {[...s].sort((a, b) => Number(b.type === "PLANS") - Number(a.type === "PLANS")).map((d) => {
                  const done = takeoffs.filter((t) => t.documentId === d.id).sort((a, b) => a.page - b.page);
                  return (
                    <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                      <Link href={`/projects/${job.id}/takeoff/${d.id}`} className="font-medium text-btr-link hover:underline">
                        {d.fileName}
                      </Link>
                      <Badge variant="outline">{d.type.toLowerCase()}</Badge>
                      {d.pages != null && <span className="text-muted-foreground">{d.pages} pg</span>}
                      {done.map((t) => (
                        <Link key={t.page} href={`/projects/${job.id}/takeoff/${d.id}?page=${t.page}`} className="rounded bg-btr-blue-soft px-1.5 py-0.5 text-xs hover:underline">
                          p.{t.page} · {(t.items as unknown[]).length} traced{t.savedToJob ? " · sent" : ""}
                        </Link>
                      ))}
                      <span className="ml-auto text-xs text-muted-foreground">{when(d.uploadedAt)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
