import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { STAFF_ROLES } from "@/lib/roles";
import { CREW_SCOPES, list, suggestions } from "@/lib/production/assign";
import { savePmAction, saveCrewScopesAction } from "./actions";

const box = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const btn = "h-8 rounded-md bg-btr-blue px-3 text-sm font-medium text-white hover:bg-btr-blue-dark";

export default async function WhoDoesWhat() {
  await requireUser(STAFF_ROLES);
  const [users, crews, sug] = await Promise.all([
    prisma.user.findMany({ where: { role: { in: ["ADMIN", "ESTIMATOR"] } }, orderBy: { name: "asc" }, select: { id: true, name: true, scheduleName: true, pmBuilders: true, pmCrews: true } }),
    prisma.crew.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, scopes: true } }),
    suggestions(),
  ]);
  const superNames = sug.supers.map((s) => s.name);
  const crewNames = crews.map((c) => c.name);
  const builderCounts = await prisma.prodLine.groupBy({ by: ["builder"], where: { builder: { not: null }, board: { in: ["ADD", "UPCOMING", "CURRENT", "WARRANTY"] } }, _count: true });
  const allBuilders = builderCounts.sort((a, b) => b._count - a._count).map((b) => b.builder!);

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div>
        <Link href="/production" className="text-sm text-btr-link hover:underline">
          ← Schedule
        </Link>
        <h1 className="text-2xl font-semibold">Who does what</h1>
        <p className="text-sm text-muted-foreground">
          For the office: tell BTRpro which builders and crews each project manager runs, and what work each crew does. PMs then see their own jobs first on the dashboard and the schedule. Boxes marked{" "}
          <span className="rounded bg-amber-100 px-1 text-amber-900">suggested</span> are BTRpro&apos;s guess from the live schedule — check them, fix them, press Save.
        </p>
      </div>

      <datalist id="supers">{superNames.map((n) => <option key={n} value={n} />)}</datalist>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Project managers</h2>
        {users.map((u) => {
          const saved = { builders: list(u.pmBuilders), crews: list(u.pmCrews) };
          const isSaved = !!u.scheduleName || saved.builders.length > 0 || saved.crews.length > 0;
          const first = u.name.split(" ")[0].toLowerCase();
          const match = sug.supers.find((s) => (u.scheduleName ? s.name === u.scheduleName : s.name.toLowerCase().split(/\s+/)[0] === first));
          const builders = [...new Set([...saved.builders, ...(match?.builders ?? [])])];
          const pmCrews = [...new Set([...saved.crews, ...(match?.crews ?? [])])];
          return (
            <form key={u.id} action={savePmAction} className="flex flex-col gap-3 rounded-md border bg-background p-3">
              <input type="hidden" name="userId" value={u.id} />
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-40 font-medium">
                  {u.name}
                  <div className="text-xs font-normal text-muted-foreground">{isSaved ? "Saved" : match ? "Not saved yet — suggestions below" : "Not saved yet"}</div>
                </div>
                <label className="flex w-64 flex-col gap-1 text-sm">
                  Name in the schedule&apos;s Super column
                  <input name="scheduleName" list="supers" defaultValue={u.scheduleName ?? (isSaved ? "" : (match?.name ?? ""))} className={box} placeholder="Leave blank if not a PM" />
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <fieldset className="flex flex-col gap-1 text-sm">
                  <legend className="mb-1 font-medium">Builder accounts</legend>
                  {builders.map((b) => (
                    <label key={b} className="flex items-center gap-2">
                      <input type="checkbox" name="builder" value={b} defaultChecked={isSaved ? saved.builders.includes(b) : true} />
                      {b}
                      {!saved.builders.includes(b) && <span className="rounded bg-amber-100 px-1 text-xs text-amber-900">suggested</span>}
                    </label>
                  ))}
                  <PickMore name="builder" label="Pick from every builder on the schedule" options={allBuilders.filter((b) => !builders.includes(b))} />
                  <textarea name="moreBuilders" rows={2} placeholder="Other builders, one per line" className="mt-1 rounded-md border border-input bg-background p-2 text-sm" />
                </fieldset>
                <fieldset className="flex flex-col gap-1 text-sm">
                  <legend className="mb-1 font-medium">Crews</legend>
                  {pmCrews.map((c) => (
                    <label key={c} className="flex items-center gap-2">
                      <input type="checkbox" name="crew" value={c} defaultChecked={isSaved ? saved.crews.includes(c) : true} />
                      {c}
                      {!saved.crews.includes(c) && <span className="rounded bg-amber-100 px-1 text-xs text-amber-900">suggested</span>}
                    </label>
                  ))}
                  <PickMore name="crew" label="Pick from every crew" options={crewNames.filter((c) => !pmCrews.includes(c))} />
                </fieldset>
              </div>
              <div>
                <button className={btn}>Save {u.name.split(" ")[0]}</button>
              </div>
            </form>
          );
        })}
        {users.length === 0 && <p className="text-sm text-muted-foreground">No Admin or Sales / Estimator users yet. Add PMs on the Users page.</p>}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Crews — what work they do</h2>
        <div className="divide-y rounded-md border bg-background">
          {crews.map((c) => {
            const saved = list(c.scopes);
            const guess = saved.length ? [] : (sug.crewScopes.get(c.name) ?? []);
            const custom = saved.filter((s) => !(CREW_SCOPES as readonly string[]).includes(s));
            return (
              <form key={c.id} action={saveCrewScopesAction} className="flex flex-col gap-2 p-3 lg:flex-row lg:items-start">
                <input type="hidden" name="crewId" value={c.id} />
                <div className="font-medium lg:w-60 lg:shrink-0">
                  {c.name}
                  <div className="text-xs font-normal text-muted-foreground">{saved.length ? "Saved" : guess.length ? "Suggested from the schedule" : "Not filled in"}</div>
                </div>
                <div className="flex flex-1 flex-wrap gap-x-4 gap-y-1 text-sm">
                  {CREW_SCOPES.map((s) => (
                    <label key={s} className={`flex items-center gap-1.5 ${guess.includes(s) ? "rounded bg-amber-100 px-1 text-amber-900" : ""}`}>
                      <input type="checkbox" name="scope" value={s} defaultChecked={saved.includes(s) || guess.includes(s)} />
                      {s}
                    </label>
                  ))}
                  <input name="other" defaultValue={custom.join(", ")} placeholder="Other (comma separated)" className="h-8 w-56 rounded-md border border-input bg-background px-2 text-sm" />
                </div>
                <button className={btn}>Save</button>
              </form>
            );
          })}
          {crews.length === 0 && <p className="p-3 text-sm text-muted-foreground">No crews yet — they load from the schedule&apos;s crew list on the next sync.</p>}
        </div>
      </section>
    </div>
  );
}

function PickMore({ name, label, options }: { name: string; label: string; options: string[] }) {
  if (!options.length) return null;
  return (
    <details className="rounded-md border px-2 py-1">
      <summary className="cursor-pointer text-sm text-btr-link">
        {label} ({options.length})
      </summary>
      <div className="grid max-h-64 gap-x-3 gap-y-1 overflow-y-auto py-2 sm:grid-cols-2">
        {options.map((o) => (
          <label key={o} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name={name} value={o} />
            {o}
          </label>
        ))}
      </div>
    </details>
  );
}
