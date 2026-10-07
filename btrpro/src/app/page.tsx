import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, ChevronRight, ClipboardList, Home, Megaphone, PlusCircle, Receipt, Search, Star } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getMarketView } from "@/lib/market";
import { activityCounts, dashboardData, workSchedule } from "@/lib/dashboard";
import { dashboardSchedules } from "@/lib/dashboard-schedules";
import { SheetDateBanner } from "@/components/sheet-banner";
import { Panel, axLink } from "@/components/shell/panel";
import { goto } from "@/lib/shell/goto";
import { reminders } from "@/lib/tasks/service";

// The front page: only what someone needs to start the day. Everything else (pipeline, leaderboard, activity feed,
// A/R aging) is on Company overview, one click away.
const usd0 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const short = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : usd0(n));
const md = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;

export default async function Home_({ searchParams }: { searchParams: Promise<{ denied?: string; dash?: string; q?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  // the office and purchasing start on their own to-do lists (this page is one click away)
  if (!sp.denied && !sp.dash && (user.role === "OFFICE" || user.role === "PURCHASING")) redirect(user.role === "OFFICE" ? "/desk/office" : "/desk/purchasing");
  const view = await getMarketView();
  const staff = user.role !== "VIEWER";
  const admin = user.role === "ADMIN";
  const now = new Date();
  const [data, sched, counts, update, sq, myTasks, rem, found] = await Promise.all([
    dashboardData(view),
    workSchedule(view),
    activityCounts(view),
    prisma.companyUpdate.findFirst({ include: { author: { select: { name: true } } }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }] }),
    dashboardSchedules({ userId: user.id, userName: user.name, view, es: undefined, pc: undefined }),
    prisma.task.findMany({ where: { doneAt: null, assigneeId: user.id }, include: { project: { select: { id: true, name: true } } }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }], take: 12 }),
    staff ? reminders(user, now) : Promise.resolve([]),
    sp.q?.trim() ? goto(sp.q, user, now) : Promise.resolve(null),
  ]);
  // one list: what's urgent first, then by due date
  const priorities = [
    ...rem.map((r) => ({ key: `r-${r.href}-${r.text}`, text: r.text, href: r.href, due: r.due, urgent: r.urgent })),
    ...myTasks.map((t) => ({ key: t.id, text: t.project ? `${t.title} — ${t.project.name}` : t.title, href: t.project ? `/projects/${t.project.id}` : "/today", due: t.dueDate, urgent: !!t.dueDate && t.dueDate.getTime() < now.getTime() + 86_400_000 })),
  ].sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity));
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
        <span className="flex gap-4 text-sm">
          <Link href="/help" className="font-medium text-btr-link hover:underline">
            How do I…?
          </Link>
          <Link href="/overview" className="text-btr-link hover:underline">
            Company overview →
          </Link>
        </span>
      </div>
      {sp.denied && <p className="border-l-4 border-l-btr-blue bg-background p-3 text-sm">Your role can&apos;t open that page.</p>}
      <SheetDateBanner />

      {/* say what you need; get buttons straight to it */}
      <section className="rounded-xl border-2 border-btr-blue/40 bg-background p-4">
        <form action="/" method="get" className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="q" className="sr-only">
            What do you need to do?
          </label>
          <div className="relative flex-1">
            <Search size={20} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
            <input id="q" name="q" defaultValue={sp.q ?? ""} autoComplete="off" placeholder="What do you need to do?  e.g. “schedule a model for DR KC next week”" className="h-14 w-full rounded-lg border bg-background pr-3 pl-11 text-lg outline-none focus:border-btr-blue focus:ring-2 focus:ring-btr-blue/30" />
          </div>
          <button type="submit" className="h-14 rounded-lg bg-btr-blue px-6 text-lg font-medium text-white hover:opacity-90">
            Go
          </button>
        </form>
        {found ? (
          found.hits.length ? (
            <div className="mt-3 flex flex-col gap-2">
              {found.when && <p className="text-sm text-muted-foreground">Start date: {found.when.said} ({found.when.date}) — filled in for you.</p>}
              {found.hits.map((h, i) => (
                <Link key={h.href} href={h.href} className={`flex items-center gap-3 rounded-lg border px-4 py-3 hover:border-btr-blue hover:bg-btr-blue-soft ${i === 0 ? "border-btr-blue bg-btr-blue-soft" : ""}`}>
                  <span className="shrink-0 rounded-full bg-btr-blue px-2.5 py-0.5 text-xs font-medium text-white">{h.tag}</span>
                  <span className="flex-1 text-base font-medium">{h.label}</span>
                  {h.note && <span className="hidden text-xs text-muted-foreground sm:inline">{h.note}</span>}
                  <ChevronRight size={18} className="text-btr-blue" />
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Couldn&apos;t tell where that goes. Try naming the builder, the model, the job&apos;s address, or what you want to do (schedule, invoice, order, receipt…).</p>
          )
        ) : (
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            {["schedule a model for DR KC next week", "invoice 1234 main st", "scan a receipt", "new lead", "order materials"].map((ex) => (
              <Link key={ex} href={`/?q=${encodeURIComponent(ex)}`} className="rounded-full border px-3 py-1 text-muted-foreground hover:border-btr-blue hover:text-foreground">
                {ex}
              </Link>
            ))}
          </div>
        )}
      </section>

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

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel title={`Your priorities (${priorities.length})`} right={<Link className={axLink} href="/today">My day</Link>} bodyClass="divide-y">
          {priorities.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Nothing assigned to you right now.</p>
          ) : (
            priorities.slice(0, 8).map((t) => (
              <Link key={t.key} href={t.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/60">
                <Star size={16} className={t.urgent ? "shrink-0 fill-red-600 text-red-600" : "shrink-0 text-muted-foreground"} aria-label={t.urgent ? "urgent" : undefined} />
                <span className="min-w-0 flex-1 truncate text-sm">{t.text}</span>
                <span className={`shrink-0 text-xs tabular-nums ${t.urgent ? "font-semibold text-red-700" : "text-muted-foreground"}`}>{t.due ? md(t.due) : ""}</span>
              </Link>
            ))
          )}
          {priorities.length > 8 && (
            <Link href="/today" className="block px-4 py-2 text-xs text-btr-link">
              {priorities.length - 8} more →
            </Link>
          )}
        </Panel>

        <Panel title="Needs the office" right={<ClipboardList size={16} className="text-btr-blue" />} bodyClass="divide-y">
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
        </Panel>
      </div>

      <Panel title="Production schedule" right={<Link className={axLink} href="/production">See all ({sq.prodCount})</Link>} bodyClass="overflow-x-auto">
        {sq.lines.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Nothing on the schedule right now.</p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                {["Start", "Address / job", "Builder", "Model", "Trade", "Crew", "Super"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sq.lines.slice(0, 12).map((l) => (
                <tr key={l.id} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{l.startDate ? md(l.startDate) : l.board === "ADD" ? <span className="text-amber-700">new</span> : l.board === "UPCOMING" ? "next" : "now"}</td>
                  <td className="max-w-[260px] truncate px-3 py-2">
                    <Link href={`/production/${l.id}`} className="font-medium text-btr-link hover:underline">
                      {l.location ?? l.project ?? "—"}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{l.builder ?? (l.market === "COMMERCIAL" ? l.project : "")}</td>
                  <td className="max-w-[200px] truncate px-3 py-2">{l.model ?? ""}</td>
                  <td className="px-3 py-2">{l.type ?? ""}</td>
                  <td className="px-3 py-2">{l.crew ?? ""}</td>
                  <td className="px-3 py-2">{l.superName ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Estimating schedule" right={<Link className={axLink} href="/estimating/schedule">See all ({sq.esCount})</Link>} bodyClass="overflow-x-auto">
        {sq.estimates.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Nothing being bid right now.</p>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                {["Due", "Project", "Customer", "Scope", "Estimator"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sq.estimates.slice(0, 10).map((e) => {
                const late = e.dueAt && e.dueAt.getTime() < now.getTime() - 86_400_000;
                return (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className={`px-3 py-2 whitespace-nowrap tabular-nums ${late ? "font-semibold text-red-700" : ""}`}>
                      {e.dueAt ? md(e.dueAt) : "—"}
                      {e.priority === "ASAP" && <span className="ml-1 text-xs text-red-700">ASAP</span>}
                    </td>
                    <td className="max-w-[260px] truncate px-3 py-2">
                      <Link href={`/estimating/schedule/${e.id}`} className="font-medium text-btr-link hover:underline">
                        {e.project}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{e.customer ?? ""}</td>
                    <td className="px-3 py-2">{e.scope ?? ""}</td>
                    <td className="px-3 py-2">{e.estimator ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

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
