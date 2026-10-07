import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCrew } from "@/lib/crew/auth";
import { CrewError, crewLine } from "@/lib/crew/service";
import { prisma } from "@/lib/db";
import { houseOf } from "@/lib/builders/house";
import { CrewHeader } from "../../crew-header";
import { crewDoneAction } from "../../actions";

const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

// One house / job from the crew's schedule: where, what, the material list (no prices), and "Done".
export default async function CrewLinePage({ params }: { params: Promise<{ id: string }> }) {
  const crew = await requireCrew();
  const { id } = await params;
  const line = await crewLine(crew, id).catch((e) => (e instanceof CrewError ? null : Promise.reject(e)));
  if (!line) notFound();
  const job = line.projectId ? await prisma.project.findUnique({ where: { id: line.projectId }, select: { builderHouse: true, address: true } }) : null;
  const h = job ? houseOf(job) : null;
  const trade = /gutter/i.test(line.type ?? "") ? "GUTTERS" : "ROOFING";
  const mats = h?.materials[trade] ?? [];
  const where = job?.address ?? line.location ?? "";
  // the crew's notes: without the color (shown on its own) and the office's bookkeeping
  const notes = (line.notes ?? "")
    .split(" · ")
    .filter((n) => n && !/^Color:/i.test(n) && !/plan book$/i.test(n))
    .join(" · ");
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <CrewHeader name={crew.name} />
      <Link href="/crew" className="text-sm text-muted-foreground">
        ← My schedule
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">{line.location ?? line.project}</h1>
        <p className="text-muted-foreground">{[line.builder, line.model, line.type].filter(Boolean).join(" · ")}</p>
      </div>
      {where && (
        <a href={`https://maps.google.com/?q=${encodeURIComponent(where)}`} target="_blank" rel="noreferrer" className="rounded-xl bg-btr-blue py-4 text-center text-lg font-semibold text-white">
          Directions
        </a>
      )}
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 rounded-xl border p-4">
        {[
          ["Start", line.startDate ? line.startDate.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }) : "Not set yet"],
          ["Super", line.superName],
          ["Color", h?.color],
          ["Notes", notes],
        ]
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k as string} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      {mats.length > 0 && (
        <section className="rounded-xl border p-4">
          <h2 className="mb-2 font-semibold">Materials for this house</h2>
          <ul className="divide-y">
            {mats.map((m) => (
              <li key={m.name} className="flex justify-between py-1.5">
                <span>{m.name}</span>
                <span className="font-medium tabular-nums">{fmtQty(m.qty)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {line.projectId && (
        <Link href={`/crew/jobs/${line.projectId}`} className="rounded-xl border py-3 text-center font-medium">
          Photos for this job
        </Link>
      )}
      <form action={crewDoneAction}>
        <input type="hidden" name="id" value={line.id} />
        <button type="submit" className="w-full rounded-xl bg-green-700 py-4 text-lg font-semibold text-white">
          Done — tell the office
        </button>
      </form>
    </div>
  );
}
