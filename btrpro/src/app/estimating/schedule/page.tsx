import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { serviceAccountEmail } from "@/lib/integrations/google-sa";
import { DEFAULT_ESTIMATING_SHEET, PRIORITIES, type Priority } from "@/lib/estimating/schedule";
import { SheetSettings, SyncButton } from "@/components/estimating/schedule-forms";
import { Badge } from "@/components/ui/badge";
import { appName } from "@/lib/company-profile";

type Search = { m?: string; q?: string; show?: string };
type Section = { id: string; title: string; hint?: string; where: Prisma.EstimateLogWhereInput; order: Prisma.EstimateLogOrderByWithRelationInput[]; limit: number | null; cols: "bid" | "followup" | "sold" | "lost" | "hildy" | "tract" };

const byDue: Prisma.EstimateLogOrderByWithRelationInput[] = [{ dueAt: { sort: "asc", nulls: "last" } }, { receivedAt: "asc" }];
const newest: Prisma.EstimateLogOrderByWithRelationInput[] = [{ bidDate: { sort: "desc", nulls: "last" } }, { dueAt: { sort: "desc", nulls: "last" } }, { receivedAt: { sort: "desc", nulls: "last" } }, { sourceRow: "desc" }];
const sheetOrder: Prisma.EstimateLogOrderByWithRelationInput[] = [{ sourceRow: "asc" }];

const SECTIONS: Record<"commercial" | "residential", Section[]> = {
  commercial: [
    { id: "c-now", title: "Bidding now", where: { board: "CURRENT", market: "COMMERCIAL" }, order: byDue, limit: null, cols: "bid" },
    { id: "c-misc", title: "Other estimating tasks", hint: "Pricebook updates, finalizing proposals, add-alternates", where: { board: "MISC", market: "COMMERCIAL" }, order: byDue, limit: null, cols: "bid" },
    { id: "c-sent", title: "Bids sent — follow up", where: { board: "SENT", market: "COMMERCIAL" }, order: newest, limit: 40, cols: "followup" },
    { id: "c-redraw", title: "Redrawings", where: { board: "REDRAW" }, order: newest, limit: 40, cols: "followup" },
    { id: "c-sold", title: "Sold — PM handoff", hint: "Submittals, contracts, material contract", where: { board: "SOLD" }, order: sheetOrder, limit: 40, cols: "sold" },
    { id: "c-lost", title: "Lost", where: { board: "LOST" }, order: newest, limit: 25, cols: "lost" },
    { id: "c-pass", title: "Passing on", where: { board: "PASSING", market: "COMMERCIAL" }, order: newest, limit: 25, cols: "bid" },
    { id: "c-archive", title: "Archive", hint: "Old open items (2023–24) and the 2022 list", where: { board: "ARCHIVE", market: "COMMERCIAL" }, order: newest, limit: 0, cols: "bid" },
  ],
  residential: [
    { id: "r-new", title: "Bidding now — new build", where: { board: "CURRENT", market: "RESIDENTIAL", NOT: { kind: "REMODEL" } }, order: byDue, limit: null, cols: "bid" },
    { id: "r-remodel", title: "Bidding now — remodels & re-roofs", where: { board: "CURRENT", market: "RESIDENTIAL", kind: "REMODEL" }, order: byDue, limit: null, cols: "bid" },
    { id: "r-misc", title: "Other estimating tasks", where: { board: "MISC", market: "RESIDENTIAL" }, order: byDue, limit: null, cols: "bid" },
    { id: "r-sent-new", title: "Completed — new construction", where: { board: "SENT", market: "RESIDENTIAL", kind: "NEW_BUILD" }, order: newest, limit: 40, cols: "followup" },
    { id: "r-sent-remodel", title: "Completed — remodels", where: { board: "SENT", market: "RESIDENTIAL", kind: "REMODEL" }, order: newest, limit: 40, cols: "followup" },
    { id: "r-hildy", title: "Hildy Homes", hint: "Lot, plan, sell and profit per bid", where: { board: "SENT", kind: "Hildy Homes" }, order: newest, limit: 25, cols: "hildy" },
    { id: "r-sharf", title: "Sharf (Iowa)", where: { board: "SENT", kind: "Sharf" }, order: newest, limit: 0, cols: "followup" },
    { id: "r-other", title: "Other completed", where: { board: "SENT", market: "RESIDENTIAL", OR: [{ kind: null }, { kind: { notIn: ["NEW_BUILD", "REMODEL", "Hildy Homes", "Sharf"] } }] }, order: newest, limit: 25, cols: "followup" },
    { id: "r-tract", title: "Tract builder scopes", where: { board: "TRACT" }, order: sheetOrder, limit: null, cols: "tract" },
    { id: "r-pass", title: "Passing on", where: { board: "PASSING", market: "RESIDENTIAL" }, order: newest, limit: 25, cols: "bid" },
  ],
};

const day = (d: Date | null) => (d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(2)}` : "");
const PRIORITY_BADGE: Record<string, "red" | "amber" | "blue" | "green"> = { ASAP: "red", REVIEW: "amber", SOLD_RFQ: "green" };

function dueTone(due: Date | null, today: Date) {
  if (!due) return "";
  const days = Math.floor((due.getTime() - today.getTime()) / 86_400_000);
  return days < 0 ? "text-red-700 font-semibold" : days <= 2 ? "text-amber-700 font-semibold" : "";
}

function searchWhere(q: string): Prisma.EstimateLogWhereInput {
  return { OR: ["customer", "project", "scope", "status", "waitingOn", "sentTo", "notes", "results", "estimator"].map((k) => ({ [k]: { contains: q } })) };
}

type Row = Awaited<ReturnType<typeof prisma.estimateLog.findMany>>[number];

function Cells({ r, cols, today }: { r: Row; cols: Section["cols"]; today: Date }) {
  const extra = (r.extra as Record<string, string> | null) ?? {};
  const name = (
    <span>
      <Link href={`/estimating/schedule/${r.id}`} className="font-medium text-btr-link hover:underline">
        {r.project}
      </Link>
      {r.folderLink && (
        <a href={r.folderLink} target="_blank" rel="noreferrer" className="ml-1.5 text-xs text-muted-foreground hover:underline">
          folder
        </a>
      )}
      {r.projectId && (
        <Link href={`/projects/${r.projectId}`} className="ml-1.5 text-xs text-btr-link hover:underline">
          job
        </Link>
      )}
      {r.priority !== "STANDARD" && (
        <Badge variant={PRIORITY_BADGE[r.priority] ?? "blue"} className="ml-1.5">
          {PRIORITIES[r.priority as Priority] ?? r.priority}
        </Badge>
      )}
      {r.kind === "REMODEL" && r.market === "COMMERCIAL" && <span className="ml-1.5 text-xs text-muted-foreground">remodel</span>}
    </span>
  );
  const note = (t: string | null) => (t ? <span className="line-clamp-2 text-xs text-muted-foreground" title={t}>{t}</span> : null);
  if (cols === "bid")
    return (
      <>
        <td className={`whitespace-nowrap px-2 py-1.5 tabular-nums ${dueTone(r.board === "CURRENT" ? r.dueAt : null, today)}`}>{day(r.dueAt) || extra.Due || ""}</td>
        <td className="px-2 py-1.5">{name}<div className="text-xs text-muted-foreground">{r.customer}</div></td>
        <td className="px-2 py-1.5 text-xs">{r.scope}</td>
        <td className="px-2 py-1.5 text-xs">{r.estimator}</td>
        <td className="whitespace-nowrap px-2 py-1.5 text-xs tabular-nums">{day(r.receivedAt)}{r.sentAt && <div className="text-muted-foreground">sent {day(r.sentAt)}</div>}</td>
        <td className="px-2 py-1.5 text-xs">{r.status}</td>
        <td className="px-2 py-1.5 text-xs">{r.waitingOn}</td>
        <td className="max-w-xs px-2 py-1.5">{note(r.notes)}</td>
      </>
    );
  if (cols === "followup")
    return (
      <>
        <td className="whitespace-nowrap px-2 py-1.5 text-xs tabular-nums">{day(r.bidDate ?? r.dueAt ?? r.receivedAt)}</td>
        <td className="px-2 py-1.5">{name}<div className="text-xs text-muted-foreground">{r.customer}</div></td>
        <td className="px-2 py-1.5 text-xs">{r.scope}</td>
        <td className="px-2 py-1.5 text-xs">{r.status}</td>
        <td className="px-2 py-1.5 text-xs">{r.sentTo ?? r.estimator}{extra["Hardie exp."] && <div className="text-muted-foreground">Hardie exp. {extra["Hardie exp."]}</div>}{extra["Missing material quote"] && <div className="text-amber-700">missing quote: {extra["Missing material quote"]}</div>}</td>
        <td className="max-w-md px-2 py-1.5">{note(r.results)}{note(r.notes)}</td>
      </>
    );
  if (cols === "sold")
    return (
      <>
        <td className="px-2 py-1.5 text-xs">{r.kind}</td>
        <td className="px-2 py-1.5">{name}<div className="text-xs text-muted-foreground">{r.customer}{extra["Project Address"] && ` · ${extra["Project Address"]}`}</div></td>
        <td className="px-2 py-1.5 text-xs">{r.scope}</td>
        <td className="px-2 py-1.5 text-xs">{[extra.PM && `PM ${extra.PM}`, extra.Super && `Super ${extra.Super}`, extra["Holds Material Contract"] && `Material: ${extra["Holds Material Contract"]}`].filter(Boolean).join(" · ")}</td>
        <td className="px-2 py-1.5 text-xs">{r.status}{extra["Project Install Dates"] && <div className="text-muted-foreground">Install {extra["Project Install Dates"]}</div>}</td>
        <td className="px-2 py-1.5 text-xs">{["Submittal In Progress", "Submittal Submitted", "Submittals Approved", "Contract Signed", "Material Contract Issued"].map((k) => extra[k] && <div key={k}>{k.replace("Submittal", "Subm.").replace("Material Contract Issued", "Mat. contract")}: {extra[k]}</div>)}</td>
        <td className="max-w-xs px-2 py-1.5">{note(r.notes)}</td>
      </>
    );
  if (cols === "lost")
    return (
      <>
        <td className="whitespace-nowrap px-2 py-1.5 text-xs tabular-nums">{day(r.bidDate)}</td>
        <td className="px-2 py-1.5">{name}<div className="text-xs text-muted-foreground">{r.customer}</div></td>
        <td className="px-2 py-1.5 text-xs">{r.scope}</td>
        <td className="px-2 py-1.5 text-xs">{extra.Reason ?? r.status}</td>
        <td className="px-2 py-1.5 text-xs">{extra["Winning sub"]}</td>
        <td className="max-w-md px-2 py-1.5">{note(r.notes)}{note(r.results)}</td>
      </>
    );
  if (cols === "hildy")
    return (
      <>
        <td className="whitespace-nowrap px-2 py-1.5 text-xs tabular-nums">{day(r.bidDate)}</td>
        <td className="px-2 py-1.5">{name}</td>
        <td className="px-2 py-1.5 text-xs">{r.scope}</td>
        <td className="px-2 py-1.5 text-xs">{[extra["Walkout/Daylight"] && "Walkout/daylight", extra["Full dig"] && "Full dig"].filter(Boolean).join(", ")}</td>
        <td className="px-2 py-1.5 text-right text-xs tabular-nums">{extra.Sell}</td>
        <td className="px-2 py-1.5 text-right text-xs tabular-nums">{extra.Profit}</td>
        <td className="max-w-xs px-2 py-1.5">{note(r.notes)}</td>
      </>
    );
  return (
    <>
      <td className="px-2 py-1.5">{name}</td>
      <td className="whitespace-pre-line px-2 py-1.5 text-xs">{r.scope}</td>
    </>
  );
}

const HEADS: Record<Section["cols"], string[]> = {
  bid: ["Due", "Project / customer", "Scope", "Est.", "Received", "Status", "Waiting on", "Notes"],
  followup: ["Date", "Project / customer", "Scope", "Status", "Sent to", "Results / notes"],
  sold: ["Group", "Project", "Scope", "Team", "Status", "Submittals & contract", "Notes"],
  lost: ["Bid date", "Project / GC", "Scope", "Reason", "Winning sub", "Notes"],
  hildy: ["Date bid", "Address / lot", "Plan", "Foundation", "Sell", "Profit", "Notes"],
  tract: ["Builder", "Standard scope"],
};

export default async function EstimatingSchedule({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const tab = sp.m === "residential" ? "residential" : "commercial";
  const q = sp.q?.trim() ?? "";
  const canEdit = user.role !== "VIEWER";
  const today = new Date(new Date().toISOString().slice(0, 10) + "T12:00:00Z");
  const [settings, counts] = await Promise.all([
    getSettings(),
    prisma.estimateLog.groupBy({ by: ["board", "market"], where: { board: "CURRENT" }, _count: true }),
  ]);
  const sections = await Promise.all(
    SECTIONS[tab].map(async (s) => {
      const where: Prisma.EstimateLogWhereInput = q ? { AND: [s.where, searchWhere(q)] } : s.where;
      const all = sp.show === s.id || !!q;
      const take = all ? (q ? 200 : undefined) : (s.limit ?? undefined);
      const [rows, total] = await Promise.all([take === 0 ? Promise.resolve([] as Row[]) : prisma.estimateLog.findMany({ where, orderBy: s.order, take }), prisma.estimateLog.count({ where })]);
      return { s, rows, total };
    }),
  );
  const nowCount = (m: string) => counts.find((c) => c.market === m)?._count ?? 0;
  const live = sections.filter((x) => x.s.cols === "bid" && x.s.id.match(/now|new$|remodel$/)).flatMap((x) => x.rows);
  const overdue = live.filter((r) => r.dueAt && r.dueAt < today).length;
  const week = live.filter((r) => r.dueAt && r.dueAt >= today && r.dueAt.getTime() - today.getTime() <= 7 * 86_400_000).length;
  const link = (m: string) => `/estimating/schedule?m=${m}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const synced = settings.estimatingSyncedAt ? new Date(settings.estimatingSyncedAt) : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Estimating schedule</h1>
          <p className="text-sm text-muted-foreground">
            {settings.estimatingSheetOff
              ? `${appName()} is the schedule.`
              : `Synced from the Google estimating sheet${synced ? ` · last ${synced.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : " · not synced yet"}. A row edited here stays as edited.`}
          </p>
        </div>
        {canEdit && (
          <Link href={`/estimating/schedule/new?m=${tab}`} className="rounded-md bg-btr-blue px-3 py-2 text-sm font-medium text-white hover:bg-btr-blue-dark">
            New bid
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b">
        {(["commercial", "residential"] as const).map((m) => (
          <Link key={m} href={link(m)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === m ? "border-btr-blue text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {m === "commercial" ? "Commercial" : "Residential"} <span className="text-xs text-muted-foreground">({nowCount(m.toUpperCase())} bidding)</span>
          </Link>
        ))}
        <form className="ml-auto flex gap-2 pb-1.5">
          <input type="hidden" name="m" value={tab} />
          <input name="q" defaultValue={q} placeholder="Search GC, project, scope, notes…" className="h-8 w-64 rounded-md border border-input bg-background px-2 text-sm" />
          {q && (
            <Link href={link(tab).replace(/&q=.*/, "")} className="self-center text-xs text-muted-foreground hover:underline">
              clear
            </Link>
          )}
        </form>
      </div>

      {!q && (
        <div className="flex flex-wrap gap-4 text-sm">
          <span>
            <b className="tabular-nums">{live.length}</b> bidding now
          </span>
          <span className={overdue ? "text-red-700" : ""}>
            <b className="tabular-nums">{overdue}</b> past due
          </span>
          <span className={week ? "text-amber-700" : ""}>
            <b className="tabular-nums">{week}</b> due in the next 7 days
          </span>
        </div>
      )}

      {sections.map(({ s, rows, total }) =>
        q && !total ? null : (
          <section key={s.id} id={s.id} className="flex flex-col gap-1.5">
            <h2 className="flex flex-wrap items-baseline gap-2 font-semibold">
              {s.title} <span className="text-sm font-normal text-muted-foreground">{total}</span>
              {s.hint && <span className="text-xs font-normal text-muted-foreground">{s.hint}</span>}
              {total > rows.length && (
                <Link href={`/estimating/schedule?m=${tab}&show=${s.id}#${s.id}`} className="text-xs font-normal text-btr-link hover:underline">
                  {rows.length ? `show all ${total}` : `show ${total}`}
                </Link>
              )}
            </h2>
            {rows.length > 0 && (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      {HEADS[s.cols].map((h) => (
                        <th key={h} className="px-2 py-1.5 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((r) => (
                      <tr key={r.id} className="align-top">
                        <Cells r={r} cols={s.cols} today={today} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ),
      )}

      {canEdit && !settings.estimatingSheetOff && (
        <section className="flex flex-col gap-2 rounded-md border p-3">
          <h2 className="text-sm font-semibold">Google sheet sync</h2>
          <p className="text-xs text-muted-foreground">
            Reads every tab of the estimating sheet every 30 minutes{serviceAccountEmail() ? ` as ${serviceAccountEmail()} — the sheet must be shared with that email` : ""}. Once everyone works here instead,
            an Admin ticks &quot;{appName()} is now the estimating schedule&quot; below.
          </p>
          <SyncButton />
        </section>
      )}
      {user.role === "ADMIN" && (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-semibold">Sheet settings (Admin)</summary>
          <div className="mt-2">
            <SheetSettings link={settings.estimatingSheet ?? DEFAULT_ESTIMATING_SHEET} off={!!settings.estimatingSheetOff} />
          </div>
        </details>
      )}
    </div>
  );
}
