import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Binoculars, Camera, Receipt, Wallet, CalendarClock, FileSignature, History, Ruler, ShoppingCart, Signature, DollarSign, ListChecks, Megaphone } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getMarketView } from "@/lib/market";
import { activityCounts, activityFeed, dashboardData, leaderboard, workSchedule, type Period } from "@/lib/dashboard";
import { SheetDateBanner } from "@/components/sheet-banner";
import { MilestoneDot } from "@/components/shell/milestone-dot";
import { Panel, axLink } from "@/components/shell/panel";
import { Markdown } from "@/components/markdown";

const usd0 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const short = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : usd0(n));
function ago(d: Date) {
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `${Math.round(s / 3600)} hr`;
  const n = Math.round(s / 86400);
  return n === 1 ? "a day" : `${n} days`;
}

const ICON = {
  OI: History,
  LB: DollarSign,
  CO: FileSignature,
  OR: ShoppingCart,
  MR: Ruler,
  PS: Signature,
  TK: ListChecks,
  W: Binoculars,
  P: CalendarClock,
  CI: Wallet,
  RC: Receipt,
  PH: Camera,
} as const;

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ lb?: string; denied?: string; dash?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  // the office and purchasing start on their own to-do lists (the dashboard is one click away)
  if (!sp.lb && !sp.denied && !sp.dash && (user.role === "OFFICE" || user.role === "PURCHASING")) redirect(user.role === "OFFICE" ? "/desk/office" : "/desk/purchasing");
  const view = await getMarketView();
  const staff = user.role !== "VIEWER";
  const admin = user.role === "ADMIN";
  const period: Period = sp.lb === "week" || sp.lb === "ytd" ? sp.lb : "month";
  const [data, feed, board, sched, counts, updates] = await Promise.all([
    dashboardData(view, user.id),
    activityFeed(view),
    staff ? leaderboard(view, period) : Promise.resolve([]),
    workSchedule(view),
    activityCounts(view),
    prisma.companyUpdate.findMany({ include: { author: { select: { name: true } } }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take: 3 }),
  ]);
  const top = Math.max(1, ...board.map((b) => b.amount));
  const lt30 = data.aging["Current"] + data.aging["1–30"];
  const bars = [
    { label: "<30", v: lt30, color: "var(--btr-future)" },
    { label: "31-60", v: data.aging["31–60"], color: "#7fb0ea" },
    { label: "61-90", v: data.aging["61–90"], color: "var(--btr-blue)" },
    { label: ">90", v: data.aging["90+"], color: "var(--btr-black)" },
  ];
  const maxBar = Math.max(1, ...bars.map((b) => b.v));
  const monthName = new Date().toLocaleString("en-US", { month: "long" });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[28px] font-light">Dashboard</h1>
        <span className="text-sm text-muted-foreground">
          {view === "ALL" ? "All jobs" : view === "RESIDENTIAL" ? "Residential" : "Commercial"} · change in the menu under your name
        </span>
      </div>
      {sp.denied && <p className="border-l-4 border-l-btr-blue bg-background p-3 text-sm">Your role can&apos;t open that page.</p>}
      <SheetDateBanner />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Current pipeline" right={<span className="text-sm">Active jobs: {data.active}</span>}>
            <div className="grid grid-cols-3 gap-y-4 sm:grid-cols-5">
              {data.pipeline.map((p) => (
                <Link key={p.key} href={`/jobs?m=${p.key}`} className="flex flex-col items-center gap-1 rounded py-2 hover:bg-muted/60">
                  <MilestoneDot stage={p.stage} size={48} />
                  <span className="text-2xl text-btr-blue tabular-nums">{p.count}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{p.value ? usd0(p.value) : "--"}</span>
                </Link>
              ))}
            </div>
          </Panel>

          {updates.length > 0 && (
            <Panel title="Company updates" right={<Link className={axLink} href="/updates">All updates</Link>} bodyClass="divide-y">
              {updates.map((u) => (
                <article key={u.id} className="flex gap-3 px-4 py-3">
                  <Megaphone size={18} className="mt-0.5 shrink-0 text-btr-blue" />
                  <div className="min-w-0 text-sm">
                    <Link href={`/updates#${u.id}`} className="font-medium hover:underline">
                      {u.pinned && <span className="mr-1 text-btr-blue">Pinned ·</span>}
                      {u.title}
                    </Link>
                    <div className="line-clamp-2 text-muted-foreground">
                      <Markdown text={u.body} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {u.author.name} · {ago(u.createdAt)} ago
                    </div>
                  </div>
                </article>
              ))}
            </Panel>
          )}

          <Panel title={`Job action items (${[...data.actions.progress, ...data.actions.financial, ...data.actions.management].filter((a) => a.n > 0 && a.key !== "W").length})`} bodyClass="flex flex-col gap-3 p-3">
            <Group label="Progress">
              {data.actions.progress.map((a) => (
                <Tile key={a.key} n={a.n} label={a.label} href={a.href} icon={a.stage ? <MilestoneDot stage={a.stage} size={24} className={a.n ? "" : "opacity-40"} /> : undefined} k={a.key} />
              ))}
            </Group>
            {staff && (
              <Group label="Financial">
                {data.actions.financial.map((a) => (
                  <Tile key={a.key} n={a.n} label={a.label} href={a.href} k={a.key} />
                ))}
              </Group>
            )}
            <Group label="Management">
              {data.actions.management.map((a) => (
                <Tile key={a.key} n={a.n} label={a.label} href={a.href} k={a.key} />
              ))}
            </Group>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Order measurements</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Outbound href="https://www.eagleview.com/" name="EagleView" note="Roof & wall reports" />
                  <Outbound href="https://www.gaf.com/en-us/for-professionals/tools/quickmeasure" name="GAF QuickMeasure" note="Roof reports" />
                </div>
              </div>
              <div>
                <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Order materials</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Outbound href="https://www.abcsupply.com/" name="ABC Supply" note="Branch #112 · 402-734-1414" />
                  <Link href="/deliveries" className="flex flex-col justify-center border bg-background px-3 py-2 hover:bg-muted/60">
                    <span className="font-medium text-btr-link">BTR material orders</span>
                    <span className="text-xs text-muted-foreground">Orders from estimates, deliveries</span>
                  </Link>
                </div>
              </div>
            </div>
          </Panel>

          {staff && (
            <Panel
              title="Leaderboard"
              right={
                <span>
                  {(["week", "month", "ytd"] as Period[]).map((p, i) => (
                    <span key={p}>
                      {i > 0 && " | "}
                      <Link href={`/?lb=${p}`} className={period === p ? "font-semibold" : axLink}>
                        {p === "ytd" ? "YTD" : p[0].toUpperCase() + p.slice(1)}
                      </Link>
                    </span>
                  ))}
                </span>
              }
            >
              {board.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No sales for {period === "month" ? monthName : period === "week" ? "this week" : "this year"} yet. Jobs count here when a signed contract date and amount are entered.
                </p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {board.map((b, i) => (
                    <li key={b.name} className="grid grid-cols-[1.5rem_minmax(0,10rem)_1fr] items-center gap-3 text-sm">
                      <span className="text-lg text-muted-foreground tabular-nums">{i + 1}</span>
                      <span className="truncate">
                        {b.name}
                        <span className="block text-xs text-muted-foreground">
                          {usd0(b.amount)} · {b.jobs} job{b.jobs === 1 ? "" : "s"}
                        </span>
                      </span>
                      <span className="h-6 bg-btr-blue" style={{ width: `${Math.max(2, (b.amount / top) * 100)}%`, opacity: i === 0 ? 1 : 0.55 }} />
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="Work schedule" right={<Link className={axLink} href="/schedule">Schedule</Link>}>
              <div className="grid grid-cols-3 divide-x text-center">
                {[
                  ["Finished yesterday", sched.done, "text-muted-foreground"],
                  ["On a roof today", sched.working, "text-btr-blue"],
                  ["Next 30 days", sched.outlook, "text-btr-ink"],
                ].map(([l, n, c]) => (
                  <Link key={l as string} href="/schedule" className="flex flex-col items-center gap-1 px-2 py-2 hover:bg-muted/50">
                    <span className={`text-4xl font-semibold tabular-nums ${c}`}>{n}</span>
                    <span className="text-xs text-muted-foreground">{l}</span>
                  </Link>
                ))}
              </div>
            </Panel>
            {admin ? (
              <Panel title="Accounts receivable" right={<Link className={axLink} href="/reports/ar">Aging report</Link>}>
                <p className="mb-2 text-sm">
                  <span className="font-medium">{short(data.arTotal)}</span> <span className="text-muted-foreground">open on sent invoices</span>
                </p>
                <div className="grid h-32 grid-cols-4 items-end gap-2">
                  {bars.map((b) => (
                    <div key={b.label} className="flex h-full flex-col justify-end text-center text-[11px]">
                      {b.v > 0 && <span className="mb-0.5 tabular-nums">{usd2(b.v)}</span>}
                      <div style={{ height: `${b.v ? Math.max(4, (b.v / maxBar) * 80) : 1}%`, background: b.color }} />
                      <span className="mt-1 border-t pt-0.5 text-muted-foreground">{b.label}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            ) : (
              <Panel title="My day" right={<Link className={axLink} href="/today">Open</Link>}>
                <p className="text-sm text-muted-foreground">Your tasks, bids due and jobs to follow up are on My day.</p>
              </Panel>
            )}
          </div>

          <Panel title="Activity count: last 30 days" bodyClass="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 xl:grid-cols-6">
            {[
              ["New leads", counts.leads],
              ["Jobs sold", counts.sold],
              ["Jobs completed", counts.completed],
              ...(staff ? [["Money collected", usd0(counts.collected)]] : []),
              ["Invoices sent", counts.invoiced],
              ["Jobs closed", counts.closed],
            ].map(([l, n]) => (
              <div key={l as string} className="border px-2 py-2 text-center">
                <div className="text-xs">{l}</div>
                <div className="text-xl text-btr-blue tabular-nums">{n}</div>
              </div>
            ))}
          </Panel>
        </div>

        <Panel title="Activity feed" className="lg:sticky lg:top-28" bodyClass="max-h-[calc(100vh-10rem)] overflow-y-auto">
          {feed.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nothing yet.</p>}
          <ol>
            {feed.map((f) => (
              <li key={f.id} className={`border-b ${f.sold ? "bg-btr-blue-soft" : ""}`}>
                <Link href={f.href} className="flex gap-3 px-3 py-2.5 hover:bg-muted/50">
                  <span className="flex w-10 shrink-0 flex-col items-center gap-1 text-[10px] text-muted-foreground">
                    <MilestoneDot stage={f.job.status} size={18} />
                    {ago(f.at)}
                  </span>
                  <span className="min-w-0 text-[13px]">
                    <span className="font-semibold text-btr-ink">{f.title}:</span> {f.by ?? ""}
                    <span className="block truncate text-btr-link">{f.job.name}</span>
                    {f.text && <span className="line-clamp-2 block text-muted-foreground">{f.text}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
    </div>
  );
}

function Tile({ n, label, href, icon, k }: { n: number; label: string; href: string; icon?: React.ReactNode; k: string }) {
  const Icon = ICON[k as keyof typeof ICON] ?? AlertTriangle;
  return (
    <Link href={href} className={`flex items-center gap-3 border bg-background px-3 py-2.5 hover:bg-muted/60 ${n ? "" : "text-muted-foreground"}`}>
      <span className={`w-8 text-lg tabular-nums ${n ? "text-btr-blue" : ""}`}>{n}</span>
      <span className={`flex-1 text-center text-xs leading-tight ${n ? "text-foreground" : "opacity-60"}`}>{label}</span>
      {icon ?? <Icon size={22} className={n ? "text-btr-blue" : "opacity-40"} />}
    </Link>
  );
}

function Outbound({ href, name, note }: { href: string; name: string; note: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex flex-col justify-center border bg-background px-3 py-2 hover:bg-muted/60">
      <span className="font-medium text-btr-link">{name}</span>
      <span className="text-xs text-muted-foreground">{note}</span>
    </a>
  );
}
