import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, ChevronRight, ClipboardList, Home, Megaphone, PlusCircle, Receipt } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getMarketView } from "@/lib/market";
import { activityCounts, dashboardData, workSchedule } from "@/lib/dashboard";
import { dashboardSchedules } from "@/lib/dashboard-schedules";
import { SheetDateBanner } from "@/components/sheet-banner";
import { Panel, axLink } from "@/components/shell/panel";

// The front page: only what someone needs to start the day. Everything else (pipeline, leaderboard, activity feed,
// A/R aging) is on Company overview, one click away.
const usd0 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const short = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : usd0(n));
const md = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;

export default async function Home_({ searchParams }: { searchParams: Promise<{ denied?: string; dash?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  // the office and purchasing start on their own to-do lists (this page is one click away)
  if (!sp.denied && !sp.dash && (user.role === "OFFICE" || user.role === "PURCHASING")) redirect(user.role === "OFFICE" ? "/desk/office" : "/desk/purchasing");
  const view = await getMarketView();
  const staff = user.role !== "VIEWER";
  const admin = user.role === "ADMIN";
  const [data, sched, counts, update, sq] = await Promise.all([
    dashboardData(view),
    workSchedule(view),
    activityCounts(view),
    prisma.companyUpdate.findFirst({ include: { author: { select: { name: true } } }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }] }),
    dashboardSchedules({ userId: user.id, userName: user.name, view, es: undefined, pc: undefined }),
  ]);
  const todo = [...(staff ? data.actions.office : []), ...data.actions.ordering].filter((a) => a.n > 0).sort((a, b) => b.n - a.n);
  const hour = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Chicago" }));
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const first = user.name.split(" ")[0];

  const buttons = [
    staff && { href: "/builders/add-house", label: "Add a builder house", note: "Pick the model, or drop in the builder's PDF", Icon: Home },
    staff && { href: "/projects/new", label: "New job or lead", note: "Customer, address, what they need", Icon: PlusCircle },
    staff && { href: "/receipts", label: "Scan a receipt", note: "Photo or PDF — it reads it for you", Icon: Receipt },
    { href: "/production", label: "Production schedule", note: `${sq.prodCount} on the board`, Icon: CalendarDays },
  ].filter(Boolean) as { href: string; label: string; note: string; Icon: typeof Home }[];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-[28px] font-light">
          {hello}, {first}
        </h1>
        <Link href="/overview" className="text-sm text-btr-link hover:underline">
          Company overview — pipeline, leaderboard, activity →
        </Link>
      </div>
      {sp.denied && <p className="border-l-4 border-l-btr-blue bg-background p-3 text-sm">Your role can&apos;t open that page.</p>}
      <SheetDateBanner />

      {/* the four things people do most, as big buttons */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {buttons.map(({ href, label, note, Icon }) => (
          <Link key={href} href={href} className="flex items-center gap-3 rounded-lg border bg-background p-4 shadow-sm hover:border-btr-blue hover:bg-btr-blue-soft">
            <Icon size={30} className="shrink-0 text-btr-blue" />
            <span className="min-w-0">
              <span className="block text-base font-semibold">{label}</span>
              <span className="block text-xs text-muted-foreground">{note}</span>
            </span>
          </Link>
        ))}
      </div>

      {/* a few numbers, plain words */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["On a roof today", String(sched.working), "/schedule"],
          ["Next 30 days", String(sched.outlook), "/schedule"],
          ["Jobs sold (30 days)", String(counts.sold), "/jobs"],
          admin ? ["Owed to us", short(data.arTotal), "/reports/ar"] : ["New leads (30 days)", String(counts.leads), "/jobs"],
        ].map(([label, n, href]) => (
          <Link key={label} href={href} className="rounded-lg border bg-background px-4 py-3 hover:bg-muted/50">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-2xl font-semibold tabular-nums text-btr-ink">{n}</div>
          </Link>
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Needs you" right={<ClipboardList size={16} className="text-btr-blue" />} bodyClass="divide-y">
          {todo.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">All caught up. Nothing waiting on anyone.</p>
          ) : (
            todo.slice(0, 8).map((a) => (
              <Link key={a.key} href={a.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/60">
                <span className="w-8 text-lg font-semibold text-btr-blue tabular-nums">{a.n}</span>
                <span className="flex-1 text-sm">{a.label}</span>
                <ChevronRight size={16} className="text-muted-foreground" />
              </Link>
            ))
          )}
          {todo.length > 8 && (
            <Link href="/overview" className="block px-4 py-2 text-xs text-btr-link">
              {todo.length - 8} more →
            </Link>
          )}
        </Panel>

        <Panel title="Estimating schedule" right={<Link className={axLink} href="/estimating/schedule">Open ({sq.esCount})</Link>} bodyClass="divide-y">
          {sq.estimates.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nothing being bid right now.</p>}
          {sq.estimates.slice(0, 7).map((e) => {
            const late = e.dueAt && e.dueAt.getTime() < Date.now() - 86_400_000;
            return (
              <Link key={e.id} href={`/estimating/schedule/${e.id}`} className="flex gap-3 px-4 py-2 hover:bg-muted/60">
                <span className={`w-12 shrink-0 text-xs tabular-nums ${late ? "font-semibold text-red-700" : "text-muted-foreground"}`}>{e.dueAt ? md(e.dueAt) : "no due"}</span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block truncate font-medium text-btr-link">
                    {e.priority === "ASAP" && <span className="mr-1 text-red-700">ASAP</span>}
                    {e.project}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{[e.customer, e.estimator].filter(Boolean).join(" · ")}</span>
                </span>
              </Link>
            );
          })}
        </Panel>

        <Panel title="Production schedule" right={<Link className={axLink} href="/production">Open ({sq.prodCount})</Link>} bodyClass="divide-y">
          {sq.lines.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nothing on the schedule right now.</p>}
          {sq.lines.slice(0, 7).map((l) => (
            <Link key={l.id} href={`/production/${l.id}`} className="flex gap-3 px-4 py-2 hover:bg-muted/60">
              <span className="w-12 shrink-0 text-xs text-muted-foreground tabular-nums">
                {l.startDate ? md(l.startDate) : l.board === "ADD" ? <span className="text-amber-700">new</span> : l.board === "UPCOMING" ? "next" : "now"}
              </span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="block truncate font-medium text-btr-link">{l.location ?? l.project ?? l.builder}</span>
                <span className="block truncate text-xs text-muted-foreground">{[l.market === "COMMERCIAL" ? l.project : l.builder, l.type, l.crew].filter(Boolean).join(" · ")}</span>
              </span>
            </Link>
          ))}
        </Panel>
      </div>

      {update && (
        <Link href={`/updates#${update.id}`} className="flex items-center gap-3 rounded-lg border bg-background px-4 py-3 text-sm hover:bg-muted/50">
          <Megaphone size={18} className="shrink-0 text-btr-blue" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{update.title}</span>
            <span className="text-muted-foreground"> · {update.author.name}</span>
          </span>
          <span className="text-xs text-btr-link">All updates →</span>
        </Link>
      )}
    </div>
  );
}
