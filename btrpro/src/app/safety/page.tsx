import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { STAFF_ROLES } from "@/lib/roles";
import { FILE_KINDS, INCIDENT_KINDS, safetyOverview, type FileKind, type IncidentKind } from "@/lib/safety/service";
import { FileForm, IncidentForm, TalkForm, YearForm } from "@/components/safety/forms";
import { deleteFileAction } from "./actions";

// roofing-heavy starter list; anything can be typed
const TOPICS = [
  "Fall protection at roof edges (guardrail, PFAS, warning lines)",
  "Ladder setup — 3 ft above the landing, tied off, 4:1",
  "Skylights and roof openings — cover or guard",
  "Steep slope — roof brackets, slide guards, anchors",
  "Heat illness — water, rest, shade",
  "Power lines near ladders and material lifts",
  "Tear-off debris — chutes, dumpster, ground crew zone",
  "Nail gun safety",
  "Torch / hot work — fire watch",
  "Housekeeping and walkway trip hazards",
  "PPE — eyes, hands, footwear",
  "Silica dust cutting fiber cement",
];

const fmt = (n: number | null, d = 2) => (n == null ? "—" : n.toFixed(d));
const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function SafetyPage() {
  const u = await requireUser(STAFF_ROLES);
  const [o, crews, jobs] = await Promise.all([
    safetyOverview(),
    prisma.crew.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ where: { status: { in: ["SOLD", "SCHEDULED", "IN_PRODUCTION"] } }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }),
  ]);
  const crewName = new Map(crews.map((c) => [c.id, c.name]));
  const office = u.role === "ADMIN" || u.role === "OFFICE";
  const done = o.years.slice(1);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Safety &amp; prequalification</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            GCs and owners prequalify subs on the last 3 years of OSHA 300A numbers, the EMR letter from the insurance carrier, a bonding letter, current insurance and a written safety program — and
            the bigger the GC, the stricter the cutoffs (EMR at or under 1.0 is common). Log talks and incidents as they happen; the packet builds itself.
          </p>
        </div>
        <a href="/api/safety/packet" target="_blank" className="rounded-md bg-btr-blue px-3 py-2 text-sm text-white hover:bg-btr-blue-dark">
          Download prequal packet (PDF)
        </a>
      </div>

      {o.missing.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
          <b>Packet is missing {o.missing.length} item{o.missing.length === 1 ? "" : "s"}:</b> {o.missing.join(" · ")}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Safety record (OSHA 300A)</h2>
        <div className="overflow-x-auto rounded-md border bg-background">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                {["Year", "Hours worked", "Recordables", "Days-away cases", "Restricted cases", "Days away", "TRIR", "DART", "EMR"].map((h, i) => (
                  <th key={h} className={`px-2 py-1.5 ${i ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {o.years.map((s, i) => (
                <tr key={s.year}>
                  <td className="px-2 py-1.5">
                    {s.year}
                    {i === 0 && <span className="text-xs text-muted-foreground"> (so far)</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{s.hoursWorked == null ? "—" : Math.round(s.hoursWorked).toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{s.recordable}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{s.daysAwayCases}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{s.restrictedCases}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{s.daysAway}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(s.trir)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(s.dartRate)}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${s.emr != null && s.emr > 1 ? "font-semibold text-red-700" : ""}`}>{fmt(s.emr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          TRIR and DART = cases × 200,000 ÷ hours worked. Hours come from payroll (W-2 hours; subs report their own). EMR comes from the carrier&apos;s letter each policy year. An EMR over 1.0 knocks you
          off many GC bid lists and raises your workers&apos; comp premium.
        </p>
        {office && (
          <div className="flex flex-col gap-1 rounded-md border bg-background p-3">
            <h3 className="text-sm font-medium">Hours, headcount and EMR by year</h3>
            {done.map((s) => (
              <YearForm key={s.year} year={s.year} hoursWorked={s.hoursWorked} avgEmployees={s.avgEmployees} emr={s.emr} />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="flex flex-col gap-2 rounded-lg border bg-background p-3">
          <h2 className="font-semibold">Toolbox talks · {o.talks30} in the last 30 days</h2>
          <TalkForm crews={crews} jobs={jobs} topics={TOPICS} />
          <h3 className="mt-2 text-sm font-medium">Crews with no talk logged in 30 days</h3>
          <p className="text-sm">
            {o.crewTalks.filter((c) => !c.talks30).map((c) => c.name).join(", ") || "None — every active crew has one."}
          </p>
          <ul className="mt-2 divide-y text-sm">
            {o.talks.slice(0, 15).map((t) => (
              <li key={t.id} className="py-1">
                <b>{day(t.date)}</b> · {t.topic} · {t.presenter}
                {t.crewId && crewName.get(t.crewId) ? ` · ${crewName.get(t.crewId)}` : ""} · {t.attendees.split("\n").length} attended
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-2 rounded-lg border bg-background p-3">
          <h2 className="font-semibold">Incidents &amp; near misses</h2>
          <IncidentForm crews={crews} jobs={jobs} kinds={Object.entries(INCIDENT_KINDS)} />
          <ul className="mt-2 divide-y text-sm">
            {o.incidents.slice(0, 15).map((i) => (
              <li key={i.id} className="py-1">
                <b>{day(i.date)}</b> · {INCIDENT_KINDS[i.kind as IncidentKind] ?? i.kind}
                {i.personName ? ` · ${i.personName}` : ""} — {i.description}
                {i.correctiveAction && <span className="block text-xs text-muted-foreground">Fix: {i.correctiveAction}</span>}
              </li>
            ))}
            {!o.incidents.length && <li className="py-1 text-muted-foreground">Nothing logged. Near misses count too — they&apos;re how you prevent the recordable.</li>}
          </ul>
        </section>
      </div>

      <section className="grid gap-5 rounded-lg border bg-background p-3 lg:grid-cols-[1fr_20rem]">
        <div>
          <h2 className="font-semibold">Company files for the packet</h2>
          <ul className="mt-1 divide-y text-sm">
            {o.files.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 py-1">
                <span>
                  <a href={`/api/safety/file/${f.id}`} target="_blank" className="text-btr-link hover:underline">
                    {f.title}
                  </a>{" "}
                  <span className="text-xs text-muted-foreground">
                    {FILE_KINDS[f.kind as FileKind] ?? f.kind} · added {day(f.createdAt)}
                    {f.expiresAt && (
                      <span className={f.expiresAt < new Date() ? " font-semibold text-red-700" : ""}>
                        {" "}
                        · expires {day(f.expiresAt)}
                      </span>
                    )}
                  </span>
                </span>
                {office && (
                  <form action={deleteFileAction}>
                    <input type="hidden" name="id" value={f.id} />
                    <button className="text-xs text-muted-foreground hover:underline">remove</button>
                  </form>
                )}
              </li>
            ))}
            {!o.files.length && <li className="py-1 text-muted-foreground">No files yet.</li>}
          </ul>
        </div>
        {office && <FileForm kinds={Object.entries(FILE_KINDS)} />}
      </section>
    </div>
  );
}
