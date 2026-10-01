import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { MEASUREMENT_BY_KEY } from "@/lib/docs/measurements";
import { Badge } from "@/components/ui/badge";

const SHEETS = /\.(pdf|png|jpe?g|webp)$/i;
const when = (d: Date) => d.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function TakeoffIndex({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const [docs, takeoffs, measured] = await Promise.all([
    prisma.document.findMany({ where: { projectId: id }, orderBy: [{ type: "asc" }, { uploadedAt: "desc" }], select: { id: true, fileName: true, type: true, pages: true, uploadedAt: true } }),
    prisma.planTakeoff.findMany({ where: { projectId: id }, select: { documentId: true, page: true, view: true, items: true, savedToJob: true, updatedAt: true } }),
    prisma.measurement.findMany({ where: { projectId: id, note: { startsWith: "Plan takeoff" } }, select: { key: true, value: true, unit: true } }),
  ]);
  const sheets = docs.filter((d) => SHEETS.test(d.fileName));
  const plansFirst = [...sheets].sort((a, b) => Number(b.type === "PLANS") - Number(a.type === "PLANS"));
  const sums = new Map<string, { value: number; unit: string | null }>();
  for (const m of measured) {
    if (m.value == null) continue;
    const cur = sums.get(m.key);
    sums.set(m.key, { value: (cur?.value ?? 0) + m.value, unit: m.unit });
  }
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-1">
        <h2 className="font-semibold">Plan takeoff</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Measure straight off the plans: set the scale on a printed dimension, check it on a second one, then trace eaves, rakes, ridges, hips, valleys,
          flashing, roof planes, wall areas, openings, corners and more. Roof-plan lines get the pitch factor. Send each sheet&apos;s totals to the job&apos;s
          measurements; numbers typed in by hand on the Documents tab still work alongside these.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Sheets on this job</h3>
        {plansFirst.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No plan files yet. Upload the plan set (PDF) or sheet images on the{" "}
            <Link href={`/projects/${id}/documents`} className="text-btr-link hover:underline">
              Documents
            </Link>{" "}
            tab.
          </p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {plansFirst.map((d) => {
              const done = takeoffs.filter((t) => t.documentId === d.id);
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <Link href={`/projects/${id}/takeoff/${d.id}`} className="font-medium text-btr-link hover:underline">
                    {d.fileName}
                  </Link>
                  <Badge variant="outline">{d.type.toLowerCase()}</Badge>
                  {d.pages != null && <span className="text-muted-foreground">{d.pages} page{d.pages === 1 ? "" : "s"}</span>}
                  {done.map((t) => (
                    <Link key={t.page} href={`/projects/${id}/takeoff/${d.id}?page=${t.page}`} className="rounded bg-btr-blue-soft px-1.5 py-0.5 text-xs hover:underline">
                      p.{t.page} · {(t.items as unknown[]).length} traced{t.savedToJob ? " · sent" : ""}
                    </Link>
                  ))}
                  <span className="ml-auto text-xs text-muted-foreground">uploaded {when(d.uploadedAt)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {sums.has("attic_sf") && (
        <p className="text-sm">
          Attic floor area is measured —{" "}
          <Link href={`/estimating/ventilation?job=${id}`} className="text-btr-link hover:underline">
            open the ventilation calculator for this job
          </Link>
          .
        </p>
      )}

      {sums.size > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Sent to the job from plan takeoff (all sheets)</h3>
          <table className="w-full max-w-xl text-sm">
            <tbody>
              {[...sums.entries()].map(([k, v]) => (
                <tr key={k} className="border-t">
                  <td className="py-1 pr-3">{MEASUREMENT_BY_KEY.get(k)?.label ?? k}</td>
                  <td className="py-1 text-right font-medium tabular-nums">
                    {Math.round(v.value * 100) / 100} {v.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
