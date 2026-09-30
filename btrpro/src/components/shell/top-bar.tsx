"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  AtSign,
  Bell,
  BookUser,
  Calendar,
  CalendarDays,
  FileText,
  Gauge,
  Hammer,
  History,
  Megaphone,
  Pin,
  Plus,
  Search,
  Settings,
  User,
  Wrench,
  X,
} from "lucide-react";
import { logout } from "@/app/actions";
import { setMarketView } from "@/app/projects/actions";
import { markNotificationsSeen } from "@/app/shell-actions";
import { Dropdown, MenuHeading } from "./dropdown";
import { MilestoneDot } from "./milestone-dot";

export type ToolItem = { href: string; label: string } | { heading: string };
export type Tool = { key: string; label: string; icon: keyof typeof ICONS; href?: string; items?: ToolItem[]; orange?: boolean };
export type RecentJob = { id: string; name: string; address: string | null; status: string };
type Note = { id: string; kind: string; at: string; title: string; text: string; href: string; by: string | null; job: string | null; stage: string | null };

const ICONS = { Plus, History, Gauge, BookUser, User, Hammer, CalendarDays, FileText, Wrench, Megaphone };

export function TopBar({
  user,
  counts,
  recent,
  tools,
  view,
  adminLinks,
}: {
  user: { name: string; role: string };
  counts: { bell: number; mentions: number; tasks: number; watching: number };
  recent: RecentJob[];
  tools: Tool[];
  view: string;
  adminLinks: { href: string; label: string }[];
}) {
  const path = usePathname();
  const [drawer, setDrawer] = useState<null | "all" | "mentions" | "messages" | "updates">(null);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const active = (t: Tool) =>
    t.href === "/" ? path === "/" : !!(t.href && path.startsWith(t.href)) || !!t.items?.some((i) => "href" in i && i.href !== "/" && path.startsWith(i.href.split("?")[0]));
  return (
    <header className="sticky top-0 z-40 text-white print:hidden">
      {/* top strip: brand, company, counters, user */}
      <div className="flex h-10 items-center gap-3 bg-[#1f3553] px-3 text-xs">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-base font-black tracking-[0.2em]">
            BTR<span className="text-[#f58220]">PRO</span>
          </span>
          <span className="hidden font-medium opacity-80 sm:inline">BTR Contracting</span>
        </Link>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <Link href="/updates" className="hidden items-center gap-1 rounded px-2 py-1 hover:bg-white/10 md:flex">
            <Megaphone size={14} /> Company updates
          </Link>
          <Counter href="/jobs?watch=1" label="Watch list" n={counts.watching}>
            <Pin size={14} />
          </Counter>
          <Counter href="/today" label="Tasks due today" n={counts.tasks}>
            <Calendar size={14} />
          </Counter>
          <button type="button" onClick={() => setDrawer("all")} className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-white/10" aria-label="Notifications">
            <Bell size={14} />
            <Badge n={counts.bell} />
          </button>
          <button type="button" onClick={() => setDrawer("mentions")} className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-white/10" aria-label="Mentions of me">
            <AtSign size={14} />
            <span className="hidden sm:inline">Me</span>
            <Badge n={counts.mentions} hot />
          </button>
          <Dropdown
            label="Account menu"
            align="right"
            width={260}
            className="flex items-center gap-1.5 rounded px-2 py-1 font-medium hover:bg-white/10"
            button={
              <>
                <span className="hidden max-w-32 truncate sm:inline">{user.name}</span>
                <Settings size={15} />
              </>
            }
          >
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {user.name} · {user.role.toLowerCase()}
            </div>
            <MenuHeading>Show jobs for</MenuHeading>
            <form action={setMarketView} className="flex gap-1 px-3 pb-2">
              {[
                ["ALL", "All"],
                ["RESIDENTIAL", "Residential"],
                ["COMMERCIAL", "Commercial"],
              ].map(([v, l]) => (
                <button key={v} name="market" value={v} aria-pressed={view === v} className={`rounded border px-2 py-1 text-xs ${view === v ? "border-[#3b7bc8] bg-[#3b7bc8] text-white" : "hover:bg-muted"}`}>
                  {l}
                </button>
              ))}
            </form>
            {adminLinks.length > 0 && <MenuHeading>Admin</MenuHeading>}
            {adminLinks.map((l) => (
              <MenuLink key={l.href} href={l.href}>
                {l.label}
              </MenuLink>
            ))}
            <div className="mt-1 border-t pt-1">
              <form action={logout}>
                <button className="w-full px-3 py-1.5 text-left hover:bg-muted">Sign out</button>
              </form>
            </div>
          </Dropdown>
        </div>
      </div>

      {/* icon toolbar + search */}
      <div className="flex items-stretch bg-[#3b7bc8]">
        <nav className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {tools.map((t) => {
            const Icon = ICONS[t.icon];
            const body = (
              <>
                <Icon size={17} />
                <span className="text-[10px] leading-none whitespace-nowrap">{t.label}</span>
              </>
            );
            const cls = `flex min-w-[52px] flex-col items-center justify-center gap-1 px-2 py-1.5 ${
              t.orange ? "bg-[#f58220] hover:bg-[#e0741a]" : active(t) ? "bg-[#2c62a3]" : "hover:bg-[#2f6cb3]"
            }`;
            if (t.key === "recent")
              return (
                <Dropdown key={t.key} label="Recent jobs" className={cls} button={body} width={320}>
                  <MenuHeading>Recently viewed jobs</MenuHeading>
                  {recent.length === 0 && <p className="px-3 py-2 text-muted-foreground">Jobs you open show up here.</p>}
                  {recent.map((j) => (
                    <Link key={j.id} href={`/projects/${j.id}`} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted">
                      <MilestoneDot stage={j.status} size={18} />
                      <span className="min-w-0">
                        <span className="block truncate text-[#2c62a3]">{j.name}</span>
                        {j.address && <span className="block truncate text-xs text-muted-foreground">{j.address}</span>}
                      </span>
                    </Link>
                  ))}
                </Dropdown>
              );
            if (t.items)
              return (
                <Dropdown key={t.key} label={t.label} className={cls} button={body}>
                  {t.items.map((i, n) =>
                    "heading" in i ? (
                      <MenuHeading key={`h${n}`}>{i.heading}</MenuHeading>
                    ) : (
                      <MenuLink key={i.href} href={i.href}>
                        {i.label}
                      </MenuLink>
                    ),
                  )}
                </Dropdown>
              );
            return (
              <Link key={t.key} href={t.href!} className={cls}>
                {body}
              </Link>
            );
          })}
        </nav>
        <JobSearch />
      </div>
      {drawer && <NotificationsDrawer initial={drawer} onClose={closeDrawer} />}
    </header>
  );
}

function JobSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      role="search"
      className="hidden w-72 items-center bg-white md:flex lg:w-96"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`/jobs?stage=all&q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Job #, customer name or address"
        aria-label="Search jobs"
        className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-gray-400"
      />
      <button className="px-3 text-[#3b7bc8]" aria-label="Search">
        <Search size={17} />
      </button>
    </form>
  );
}

function MenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} role="menuitem" className="block px-3 py-1.5 hover:bg-muted">
      {children}
    </Link>
  );
}

function Badge({ n, hot }: { n: number; hot?: boolean }) {
  return (
    <span className={`min-w-5 rounded-full px-1.5 text-center text-[10px] leading-4 font-semibold tabular-nums ${n && hot ? "bg-[#f58220]" : "bg-white/20"}`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

function Counter({ href, label, n, children }: { href: string; label: string; n: number; children: React.ReactNode }) {
  return (
    <Link href={href} title={label} aria-label={label} className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-white/10">
      {children}
      <Badge n={n} />
    </Link>
  );
}

const TABS = [
  ["all", "All"],
  ["mentions", "@Me"],
  ["messages", "Messages"],
  ["updates", "Company"],
] as const;

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 0) return "due";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `${Math.round(s / 3600)} hr`;
  const d = Math.round(s / 86400);
  return d === 1 ? "a day" : `${d} days`;
}

/** Slide-out panel on the right: job activity, messages, @mentions, and company updates. */
function NotificationsDrawer({ initial, onClose }: { initial: (typeof TABS)[number][0]; onClose: () => void }) {
  const [tab, setTab] = useState(initial);
  const [data, setData] = useState<{ seenAt: string | null; notes: Note[] } | null>(null);
  const [error, setError] = useState(false);
  const router = useRouter();
  const path = usePathname();
  const [opened] = useState(path);
  useEffect(() => {
    if (path !== opened) onClose();
  }, [path, opened, onClose]);
  useEffect(() => {
    let live = true;
    fetch("/api/notifications")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (!live) return;
        setData(d);
        markNotificationsSeen().then(() => router.refresh());
      })
      .catch(() => live && setError(true));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => {
      live = false;
      document.removeEventListener("keydown", esc);
    };
  }, [router, onClose]);
  const notes = (data?.notes ?? []).filter((n) =>
    tab === "all" ? true : tab === "mentions" ? n.kind === "mention" : tab === "messages" ? n.kind === "message" || n.kind === "mention" : n.kind === "update",
  );
  const seen = data?.seenAt ? new Date(data.seenAt).getTime() : 0;
  return (
    <div className="fixed inset-0 z-50 text-foreground" role="dialog" aria-label="Notifications">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/20" onClick={onClose} />
      <aside className="absolute top-0 right-0 flex h-full w-full max-w-sm flex-col bg-background shadow-xl">
        <div className="flex items-center justify-between border-b bg-[#f4f5f7] px-4 py-3">
          <h2 className="text-lg font-light">Notifications</h2>
          <button type="button" onClick={onClose} aria-label="Close notifications" className="rounded p-1 hover:bg-muted">
            <X size={18} />
          </button>
        </div>
        <div className="flex border-b text-sm">
          {TABS.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`flex-1 border-b-2 px-2 py-2 ${tab === k ? "border-[#3b7bc8] font-medium text-[#2c62a3]" : "border-transparent text-muted-foreground"}`}>
              {l}
            </button>
          ))}
        </div>
        <ol className="flex-1 overflow-y-auto">
          {!data && !error && <li className="p-4 text-sm text-muted-foreground">Loading…</li>}
          {error && <li className="p-4 text-sm text-destructive">Couldn&apos;t load notifications.</li>}
          {data && notes.length === 0 && <li className="p-4 text-sm text-muted-foreground">Nothing here in the last 30 days.</li>}
          {notes.map((n) => (
            <li key={n.id} className={`border-b ${new Date(n.at).getTime() > seen && n.kind !== "task" ? "bg-[#eef5fc]" : ""}`}>
              <Link href={n.href} className="flex gap-3 px-4 py-2.5 hover:bg-muted/60">
                <span className="flex w-10 shrink-0 flex-col items-center gap-1 text-[10px] text-muted-foreground">
                  {n.stage ? (
                    <MilestoneDot stage={n.stage} size={18} />
                  ) : (
                    <span className="flex size-[18px] items-center justify-center rounded-full bg-[#3b7bc8] text-white">
                      {n.kind === "update" ? <Megaphone size={10} /> : <Calendar size={10} />}
                    </span>
                  )}
                  {ago(n.at)}
                </span>
                <span className="min-w-0 text-[13px]">
                  <span className="text-[#d9412f]">{n.title}:</span> {n.by ?? ""}
                  {n.job && <span className="block truncate text-[#2c62a3]">{n.job}</span>}
                  <span className="line-clamp-2 block text-muted-foreground">{n.text}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
        <div className="border-t p-3 text-center text-sm">
          <Link href="/updates" className="text-[#2c62a3] hover:underline">
            All company updates
          </Link>
        </div>
      </aside>
    </div>
  );
}
