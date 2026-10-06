import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { STAFF_ROLES } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { DEFAULT_RADIUS, KINDS, ensureSources, type Kind } from "@/lib/bids/service";
import { addSourceAction, checkNowAction, checkOneAction, decideAction, deleteSourceAction, radiusAction, scheduleAction, toggleSourceAction } from "./actions";
import { appName, botName } from "@/lib/company-profile";

const VIEWS = { review: "To review", watch: "Watching", added: "On the schedule", all: "Everything open", passed: "Passed", sources: "Boards" } as const;
type View = keyof typeof VIEWS;
const REL: Record<string, { label: string; cls: string }> = {
  ROOFING: { label: "Roofing", cls: "bg-btr-blue text-white" },
  EXTERIOR: { label: "Exterior", cls: "bg-btr-blue-soft text-btr-blue-dark" },
  BUILDING: { label: "Building", cls: "bg-muted" },
  OTHER: { label: "Other", cls: "text-muted-foreground" },
};
const when = (d: Date) => d.toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const ago = (d: Date | null) => (d ? d.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");

export default async function BidsPage({ searchParams }: { searchParams: Promise<{ v?: string; rel?: string; q?: string; err?: string }> }) {
  const u = await requireUser(STAFF_ROLES);
  const sp = await searchParams;
  const view: View = sp.v && sp.v in VIEWS ? (sp.v as View) : "review";
  await ensureSources();
  const s = await getSettings();
  const radius = s.bidRadiusMiles ?? DEFAULT_RADIUS;
  const now = new Date();
  const open: Prisma.PublicBidWhereInput = { gone: false, OR: [{ dueAt: null }, { dueAt: { gte: now } }] };
  const range: Prisma.PublicBidWhereInput = { OR: [{ miles: null }, { miles: { lte: radius } }] };
  const relevant: Prisma.PublicBidWhereInput = { relevance: { in: ["ROOFING", "EXTERIOR", "BUILDING"] } };
  const q = sp.q?.trim();
  const where: Prisma.PublicBidWhereInput = {
    AND: [
      view === "review" ? { status: "NEW", ...open, ...relevant } : view === "watch" ? { status: "WATCH" } : view === "added" ? { status: "ADDED" } : view === "passed" ? { status: "PASS" } : open,
      view === "added" || view === "passed" || view === "watch" ? {} : range,
      sp.rel ? { relevance: sp.rel } : {},
      q ? { OR: [{ title: { contains: q } }, { agency: { contains: q } }, { city: { contains: q } }] } : {},
    ],
  };
  const [bids, sources, counts] = await Promise.all([
    view === "sources" ? [] : prisma.publicBid.findMany({ where, include: { source: { select: { name: true } } }, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }], take: 300 }),
    prisma.bidSource.findMany({ orderBy: [{ builtIn: "desc" }, { name: "asc" }], include: { _count: { select: { bids: { where: { gone: false } } } } } }),
    Promise.all([
      prisma.publicBid.count({ where: { AND: [{ status: "NEW", ...open, ...relevant }, range] } }),
      prisma.publicBid.count({ where: { status: "WATCH", ...open } }),
      prisma.publicBid.count({ where: { status: "ADDED", ...open } }),
    ]),
  ]);
  const broken = sources.filter((x) => x.enabled && x.lastError && (!x.lastOkAt || (x.lastCheckedAt && x.lastOkAt < x.lastCheckedAt)));
  const canManage = u.role !== "PURCHASING";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Public bids</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Every morning {appName()} reads SDI&apos;s plan room and the county, city, school and state bid boards within about 2 hours of Omaha or Lincoln ({radius} straight-line miles), plus federal work on
            SAM.gov. New roofing, exterior and building projects land here to review: add it to the estimating schedule, watch it, or pass.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Last checked {s.bidsCheckedAt ? ago(new Date(s.bidsCheckedAt)) : "never"} · {sources.filter((x) => x.enabled).length} boards
            {broken.length > 0 && (
              <Link href="/bids?v=sources#sources" className="ml-1 text-amber-800 underline">
                · {broken.length} couldn&apos;t be read
              </Link>
            )}
          </p>
        </div>
        <form action={checkNowAction}>
          <button className="rounded-md bg-btr-blue px-3 py-2 text-sm text-white hover:bg-btr-blue-dark">Check all boards now</button>
        </form>
      </div>

      <nav className="flex flex-wrap gap-1 border-b text-sm">
        {(Object.keys(VIEWS) as View[]).map((k) => (
          <Link key={k} href={`/bids?v=${k}`} className={`-mb-px border-b-2 px-3 py-1.5 ${view === k ? "border-btr-blue font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {VIEWS[k]}
            {k === "review" && counts[0] > 0 && <span className="ml-1 rounded-full bg-btr-blue px-1.5 text-xs text-white">{counts[0]}</span>}
            {k === "watch" && counts[1] > 0 && <span className="ml-1 text-xs text-muted-foreground">{counts[1]}</span>}
            {k === "added" && counts[2] > 0 && <span className="ml-1 text-xs text-muted-foreground">{counts[2]}</span>}
          </Link>
        ))}
      </nav>

      {view !== "sources" && (
        <>
          <form className="flex flex-wrap items-center gap-2 text-sm">
            <input type="hidden" name="v" value={view} />
            <input name="q" defaultValue={q} placeholder="Search title, owner, town" className="h-8 w-56 rounded-md border border-input bg-background px-2" />
            <select name="rel" defaultValue={sp.rel ?? ""} className="h-8 rounded-md border border-input bg-background px-1">
              <option value="">{view === "all" ? "Any type" : "Roofing, exterior & building"}</option>
              <option value="ROOFING">Roofing</option>
              <option value="EXTERIOR">Exterior / siding / windows</option>
              <option value="BUILDING">Building (GC work)</option>
              {view !== "review" && <option value="OTHER">Other (roads, utilities, services)</option>}
            </select>
            <button className="h-8 rounded-md border px-3 hover:bg-muted">Filter</button>
          </form>
          <div className="overflow-x-auto rounded-md border bg-background">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5">Bids due</th>
                  <th className="px-2 py-1.5">Project</th>
                  <th className="px-2 py-1.5">Where</th>
                  <th className="px-2 py-1.5">Type</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {bids.map((b) => {
                  const days = b.dueAt ? Math.ceil((b.dueAt.getTime() - now.getTime()) / 86_400_000) : null;
                  return (
                    <tr key={b.id} className={b.gone ? "opacity-60" : ""}>
                      <td className="px-2 py-1.5 align-top whitespace-nowrap">
                        {b.dueAt ? (
                          <>
                            <div className={days != null && days <= 7 && days >= 0 ? "font-semibold text-red-700" : ""}>{when(b.dueAt)}</div>
                            <div className="text-xs text-muted-foreground">{days! < 0 ? "closed" : days === 0 ? "today" : days === 1 ? "tomorrow" : `${days} days`}</div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">not listed</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <a href={b.url ?? "#"} target="_blank" rel="noreferrer" className="font-medium text-btr-link hover:underline">
                          {b.title}
                        </a>
                        <div className="text-xs text-muted-foreground">
                          {[b.agency, b.number && `#${b.number}`, b.source.name].filter(Boolean).join(" · ")}
                          {b.gone && " · no longer listed"}
                        </div>
                        {b.summary && <div className="max-w-xl text-xs text-muted-foreground">{b.summary.slice(0, 200)}</div>}
                      </td>
                      <td className="px-2 py-1.5 align-top whitespace-nowrap">
                        {b.city ? `${b.city}${b.state ? `, ${b.state}` : ""}` : "—"}
                        <div className={`text-xs ${b.miles != null && b.miles > radius ? "text-amber-800" : "text-muted-foreground"}`}>{b.miles != null ? `${b.miles} mi from ${b.nearest}` : "distance unknown"}</div>
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <span className={`rounded px-1.5 py-0.5 text-xs ${REL[b.relevance]?.cls}`}>{REL[b.relevance]?.label ?? b.relevance}</span>
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <div className="flex flex-wrap justify-end gap-1">
                          {b.estimateLogId ? (
                            <Link href={`/estimating/schedule/${b.estimateLogId}`} className="rounded-md border px-2 py-1 text-xs hover:bg-muted">
                              On the schedule →
                            </Link>
                          ) : (
                            <form action={scheduleAction}>
                              <input type="hidden" name="id" value={b.id} />
                              <button className="rounded-md bg-btr-blue px-2 py-1 text-xs text-white hover:bg-btr-blue-dark">Add to estimating schedule</button>
                            </form>
                          )}
                          {!b.estimateLogId && (
                            <form action={decideAction} className="flex gap-1">
                              <input type="hidden" name="id" value={b.id} />
                              {b.status !== "WATCH" && (
                                <button name="status" value="WATCH" className="rounded-md border px-2 py-1 text-xs hover:bg-muted">
                                  Watch
                                </button>
                              )}
                              {b.status !== "PASS" ? (
                                <button name="status" value="PASS" className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
                                  Pass
                                </button>
                              ) : (
                                <button name="status" value="NEW" className="rounded-md border px-2 py-1 text-xs hover:bg-muted">
                                  Undo pass
                                </button>
                              )}
                            </form>
                          )}
                        </div>
                        {b.decidedBy && <div className="mt-0.5 text-right text-[11px] text-muted-foreground">{b.decidedBy}</div>}
                      </td>
                    </tr>
                  );
                })}
                {!bids.length && (
                  <tr>
                    <td colSpan={5} className="px-2 py-3 text-muted-foreground">
                      {view === "review" ? "Nothing new to review. Check back tomorrow morning, or press Check all boards now." : "Nothing here."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === "sources" && (
        <section id="sources" className="flex flex-col gap-3">
          {sp.err && <p className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-800">{sp.err}</p>}
          <div className="overflow-x-auto rounded-md border bg-background">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5">Board</th>
                  <th className="px-2 py-1.5">Kind</th>
                  <th className="px-2 py-1.5">Last read</th>
                  <th className="px-2 py-1.5 text-right">Listed</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {sources.map((x) => {
                  const failing = x.lastError && (!x.lastOkAt || (x.lastCheckedAt && x.lastOkAt < x.lastCheckedAt));
                  return (
                    <tr key={x.id} className={x.enabled ? "" : "opacity-50"}>
                      <td className="px-2 py-1.5 align-top">
                        <a href={x.url} target="_blank" rel="noreferrer" className="text-btr-link hover:underline">
                          {x.name}
                        </a>
                        {x.lastError && <div className={`text-xs ${failing ? "text-red-700" : "text-muted-foreground"}`}>{x.lastError}</div>}
                      </td>
                      <td className="px-2 py-1.5 align-top text-xs">{KINDS[x.kind as Kind] ?? x.kind}</td>
                      <td className="px-2 py-1.5 align-top text-xs whitespace-nowrap">{ago(x.lastOkAt)}</td>
                      <td className="px-2 py-1.5 text-right align-top tabular-nums">{x._count.bids}</td>
                      <td className="px-2 py-1.5 align-top">
                        <div className="flex justify-end gap-1">
                          <form action={checkOneAction}>
                            <input type="hidden" name="id" value={x.id} />
                            <button className="rounded-md border px-2 py-1 text-xs hover:bg-muted">Check</button>
                          </form>
                          {canManage && (
                            <form action={toggleSourceAction}>
                              <input type="hidden" name="id" value={x.id} />
                              <input type="hidden" name="on" value={x.enabled ? "0" : "1"} />
                              <button className="rounded-md border px-2 py-1 text-xs hover:bg-muted">{x.enabled ? "Turn off" : "Turn on"}</button>
                            </form>
                          )}
                          {u.role === "ADMIN" && !x.builtIn && (
                            <form action={deleteSourceAction}>
                              <input type="hidden" name="id" value={x.id} />
                              <button className="px-2 py-1 text-xs text-muted-foreground hover:underline">Remove</button>
                            </form>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Boards that block automatic readers show why; check those by hand or sign up for their email alerts. The Omaha Builders Exchange and Lincoln Builders Bureau plan rooms are members-only and are
            never read automatically.
          </p>
          {canManage && (
            <div className="grid gap-4 lg:grid-cols-2">
              <form action={addSourceAction} className="flex flex-col gap-2 rounded-lg border bg-background p-3 text-sm">
                <h2 className="font-semibold">Add a bid board</h2>
                <input name="name" required placeholder="Name — e.g. City of Blair" className="h-8 rounded-md border border-input bg-background px-2" />
                <input name="url" required placeholder="https://… (the page that lists the bids)" className="h-8 rounded-md border border-input bg-background px-2" />
                <select name="kind" defaultValue="PAGE" className="h-8 rounded-md border border-input bg-background px-1">
                  {(Object.keys(KINDS) as Kind[])
                    .filter((k) => k !== "SAM")
                    .map((k) => (
                      <option key={k} value={k}>
                        {KINDS[k]}
                      </option>
                    ))}
                </select>
                <div className="grid grid-cols-[1fr_5rem] gap-2">
                  <input name="defaultCity" placeholder="Town (if the board doesn't say)" className="h-8 rounded-md border border-input bg-background px-2" />
                  <input name="defaultState" placeholder="NE" maxLength={2} className="h-8 rounded-md border border-input bg-background px-2" />
                </div>
                <p className="text-xs text-muted-foreground">Town websites ending in /Bids.aspx are CivicEngage; links with ionwave.net are IonWave. Anything else: pick &ldquo;Any page&rdquo; and {botName()} reads it.</p>
                <button className="h-8 self-start rounded-md bg-btr-blue px-3 text-white hover:bg-btr-blue-dark">Add and check</button>
              </form>
              <form action={radiusAction} className="flex flex-col gap-2 rounded-lg border bg-background p-3 text-sm">
                <h2 className="font-semibold">How far out</h2>
                <label className="flex items-center gap-2">
                  <input name="miles" type="number" min={10} max={400} defaultValue={radius} className="h-8 w-20 rounded-md border border-input bg-background px-2" /> straight-line miles from Omaha or Lincoln
                </label>
                <p className="text-xs text-muted-foreground">125 miles ≈ 2 hours&apos; drive: Kearney, Norfolk, Sioux City, Des Moines&apos;s west side, St. Joseph. Projects farther out still show under Everything open with the distance flagged.</p>
                <button className="h-8 self-start rounded-md border px-3 hover:bg-muted">Save</button>
              </form>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
