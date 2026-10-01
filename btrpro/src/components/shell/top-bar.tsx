"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  AtSign,
  ChevronDown,
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
  const crewArea = path === "/crew" || path.startsWith("/crew/");
  const active = (t: Tool) =>
    t.href === "/" ? path === "/" : !!(t.href && path.startsWith(t.href)) || !!t.items?.some((i) => "href" in i && i.href !== "/" && path.startsWith(i.href.split("?")[0]));
  const itemCls = (t: Tool) =>
    `flex h-12 items-center gap-1.5 border-b-2 px-2.5 text-[13px] whitespace-nowrap xl:px-2 ${
      active(t) ? "border-btr-blue text-white" : "border-transparent text-white/65 hover:text-white"
    }`;
  const renderTool = (t: Tool) => {
    const body = (
      <>
        {t.label}
        {t.items && <ChevronDown size={13} className="opacity-60" />}
      </>
    );
    if (t.items)
      return (
        <Dropdown key={t.key} label={t.label} className={itemCls(t)} button={body} width={t.key === "jobs" ? 300 : 240}>
          {t.items.map((i, n) =>
            "heading" in i ? (
              <MenuHeading key={`h${n}`}>{i.heading}</MenuHeading>
            ) : (
              <MenuLink key={i.href} href={i.href}>
                {i.label}
              </MenuLink>
            ),
          )}
          {t.key === "jobs" && recent.length > 0 && (
            <>
              <MenuHeading>Recently viewed</MenuHeading>
              {recent.slice(0, 6).map((j) => (
                <Link key={j.id} href={`/projects/${j.id}`} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted">
                  <MilestoneDot stage={j.status} size={16} />
                  <span className="min-w-0 truncate text-btr-link">{j.name}</span>
                </Link>
              ))}
            </>
          )}
        </Dropdown>
      );
    return (
      <Link key={t.key} href={t.href!} className={itemCls(t)}>
        {body}
      </Link>
    );
  };
  const newTool = tools.find((t) => t.key === "new");
  // the crew portal has its own header; staff menus never show there
  if (crewArea) return null;
  return (
    <header className="sticky top-0 z-40 bg-btr-black text-white print:hidden">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-2 px-3 sm:px-4">
        <Link href="/" className="mr-1 flex h-12 items-center gap-1.5 sm:mr-2" aria-label="BTRpro home">
          <span className="rounded bg-white px-1.5 py-0.5 text-sm font-black tracking-wider text-btr-black">BTR</span>
          <span className="text-sm font-semibold tracking-wide text-white/90">pro</span>
        </Link>
        {newTool?.items && (
          <Dropdown
            label="New"
            className="flex h-8 items-center gap-1 rounded-md bg-btr-blue px-3 text-[13px] font-medium hover:bg-btr-blue-dark"
            button={
              <>
                <Plus size={15} /> New
              </>
            }
          >
            {newTool.items.map((i) =>
              "heading" in i ? null : (
                <MenuLink key={i.href} href={i.href}>
                  {i.label}
                </MenuLink>
              ),
            )}
          </Dropdown>
        )}
        <nav className="order-last -mx-3 flex w-[calc(100%+1.5rem)] items-stretch overflow-x-auto border-t xl:overflow-visible border-white/10 px-1 sm:-mx-4 sm:w-[calc(100%+2rem)] xl:order-none xl:mx-0 xl:w-auto xl:flex-1 xl:border-0 xl:px-0">
          {tools.filter((t) => t.key !== "new").map(renderTool)}
        </nav>
        <div className="ml-auto flex items-center sm:gap-1">
          <JobSearch />
          <Dropdown
            label="Notifications"
            align="right"
            width={280}
            hover={false}
            className="relative rounded-md p-2 text-white/75 hover:bg-white/10 hover:text-white"
            button={
              <>
                <Bell size={18} />
                <Dot n={counts.bell + counts.mentions + counts.tasks} />
              </>
            }
          >
            <NoteRow label="Notifications" n={counts.bell} onClick={() => setDrawer("all")} icon={<Bell size={15} />} />
            <NoteRow label="Mentions of me" n={counts.mentions} onClick={() => setDrawer("mentions")} icon={<AtSign size={15} />} />
            <NoteRow label="My day — tasks due" n={counts.tasks} href="/today" icon={<Calendar size={15} />} />
            <NoteRow label="Watch list" n={counts.watching} href="/jobs?watch=1" icon={<Pin size={15} />} />
            <NoteRow label="Company updates" href="/updates" icon={<Megaphone size={15} />} />
          </Dropdown>
          <Dropdown
            label="Account menu"
            align="right"
            width={260}
            className="ml-1 flex items-center gap-2 rounded-md py-1 pr-1 pl-1 text-[13px] hover:bg-white/10"
            button={
              <>
                <Settings size={17} className="text-white/75" />
                <span className="flex size-7 items-center justify-center rounded-full bg-white/15 text-[11px] font-semibold">
                  {user.name
                    .split(/\s+/)
                    .map((w) => w[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
                <ChevronDown size={13} className="opacity-60" />
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
                <button key={v} name="market" value={v} aria-pressed={view === v} className={`rounded-md border px-2 py-1 text-xs ${view === v ? "border-btr-black bg-btr-black text-white" : "hover:bg-muted"}`}>
                  {l}
                </button>
              ))}
            </form>
            {adminLinks.length > 0 && <MenuHeading>Settings</MenuHeading>}
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
      className="mr-1 hidden h-8 w-56 items-center rounded-md bg-white/10 focus-within:bg-white/15 md:flex 2xl:w-72"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`/jobs?stage=all&q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search jobs, customers, addresses"
        aria-label="Search jobs"
        className="h-full min-w-0 flex-1 bg-transparent px-3 text-[13px] text-white outline-none placeholder:text-white/50"
      />
      <button className="px-2.5 text-white/70" aria-label="Search">
        <Search size={15} />
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

function Dot({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-btr-blue px-1 text-center text-[10px] leading-4 font-semibold text-white tabular-nums">
      {n > 99 ? "99+" : n}
    </span>
  );
}

function NoteRow({ label, n = 0, href, onClick, icon }: { label: string; n?: number; href?: string; onClick?: () => void; icon: React.ReactNode }) {
  const body = (
    <>
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1">{label}</span>
      {n > 0 && <span className="rounded-full bg-btr-blue px-1.5 text-[11px] leading-4 font-semibold text-white tabular-nums">{n > 99 ? "99+" : n}</span>}
    </>
  );
  const cls = "flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted";
  return href ? (
    <Link href={href} role="menuitem" className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" role="menuitem" onClick={onClick} className={cls}>
      {body}
    </button>
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
        <div className="flex items-center justify-between border-b bg-btr-black px-4 py-3 text-white">
          <h2 className="text-base font-semibold">Notifications</h2>
          <button type="button" onClick={onClose} aria-label="Close notifications" className="rounded p-1 hover:bg-white/10">
            <X size={18} />
          </button>
        </div>
        <div className="flex border-b text-sm">
          {TABS.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`flex-1 border-b-2 px-2 py-2 ${tab === k ? "border-btr-blue font-medium text-btr-ink" : "border-transparent text-muted-foreground"}`}>
              {l}
            </button>
          ))}
        </div>
        <ol className="flex-1 overflow-y-auto">
          {!data && !error && <li className="p-4 text-sm text-muted-foreground">Loading…</li>}
          {error && <li className="p-4 text-sm text-destructive">Couldn&apos;t load notifications.</li>}
          {data && notes.length === 0 && <li className="p-4 text-sm text-muted-foreground">Nothing here in the last 30 days.</li>}
          {notes.map((n) => (
            <li key={n.id} className={`border-b ${new Date(n.at).getTime() > seen && n.kind !== "task" ? "bg-btr-blue-soft" : ""}`}>
              <Link href={n.href} className="flex gap-3 px-4 py-2.5 hover:bg-muted/60">
                <span className="flex w-10 shrink-0 flex-col items-center gap-1 text-[10px] text-muted-foreground">
                  {n.stage ? (
                    <MilestoneDot stage={n.stage} size={18} />
                  ) : (
                    <span className="flex size-[18px] items-center justify-center rounded-full bg-btr-ink text-white">
                      {n.kind === "update" ? <Megaphone size={10} /> : <Calendar size={10} />}
                    </span>
                  )}
                  {ago(n.at)}
                </span>
                <span className="min-w-0 text-[13px]">
                  <span className="font-semibold text-btr-ink">{n.title}</span>{n.by ? <span className="text-muted-foreground"> · {n.by}</span> : null}
                  {n.job && <span className="block truncate text-btr-link">{n.job}</span>}
                  <span className="line-clamp-2 block text-muted-foreground">{n.text}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
        <div className="border-t p-3 text-center text-sm">
          <Link href="/updates" className="text-btr-link hover:underline">
            All company updates
          </Link>
        </div>
      </aside>
    </div>
  );
}
