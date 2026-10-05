import Link from "next/link";
import type { Prisma, ProdLine } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { BILLING_ROLES } from "@/lib/roles";
import { DEFAULT_COMM_SHEET, DEFAULT_RES_SHEET } from "@/lib/production/board";
import { mineWhere, pmScope } from "@/lib/production/assign";
import { ProdSheetSettings, ProdSyncButton } from "@/components/production/prod-forms";
import { stepAction } from "./actions";
import { NavSelect } from "@/components/dashboard/tab-select";
import { appName, shortName } from "@/lib/company-profile";

type Search = { v?: string; m?: string; who?: string; q?: string; all?: string };
const VIEWS = [
  ["mine", "My schedule"],
  ["full", "Full schedule"],
  ["crew", "Crew schedules"],
  ["pm", "Project managers"],
  ["billing", "Pay crews & billing"],
  ["done", "Completed"],
] as const;

const usd = (n: number | null | undefined) => (n == null ? "" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const day = (d: Date | null) => (d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : "");
const OPEN: Prisma.ProdLineWhereInput = { board: { in: ["ADD", "UPCOMING", "CURRENT", "WARRANTY"] } };

function search(q: string): Prisma.ProdLineWhereInput {
  return { OR: ["builder", "location", "project", "crew", "superName", "type", "estimateNo", "notes", "model", "vpo"].map((k) => ({ [k]: { contains: q } })) };
}

function Steps({ l, billing }: { l: ProdLine; billing: boolean }) {
  const btn = (step: string, label: string, primary = false) => (
    <form action={stepAction} key={step}>
      <input type="hidden" name="id" value={l.id} />
      <input type="hidden" name="step" value={step} />
      <button className={`h-7 rounded-md px-2 text-xs whitespace-nowrap ${primary ? "bg-btr-blue text-white hover:bg-btr-blue-dark" : "border hover:bg-muted"}`}>{label}</button>
    </form>
  );
  return (
    <div className="flex flex-wrap gap-1">
      {!l.completed && btn("complete", "Completed", true)}
      {billing && l.completed && !l.approved && btn("approve", "Crew paid")}
      {billing && l.market === "RESIDENTIAL" && l.completed && !l.billed && btn("bill", "Billed")}
      {billing && l.billed && !l.btrPaid && btn("paid", `${shortName()} paid`)}
    </div>
  );
}

function Status({ l }: { l: ProdLine }) {
  const chip = (t: string | null, tone: string) => (t ? <span className={`block text-xs ${tone}`} title={t}>{t.length > 26 ? t.slice(0, 25) + "…" : t}</span> : null);
  return (
    <>
      {chip(l.completed, "text-green-700")}
      {chip(l.approved, "text-muted-foreground")}
      {chip(l.billed, "text-blue-700")}
      {chip(l.btrPaid, "text-muted-foreground")}
    </>
  );
}

function Table({ rows, billing, showGroup }: { rows: ProdLine[]; billing: boolean; showGroup?: boolean }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing here.</p>;
  const pay = rows.reduce((a, r) => a + (r.payout ?? 0), 0);
  const sell = rows.reduce((a, r) => a + (r.sell ?? 0), 0);
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5">Start</th>
            <th className="px-2 py-1.5">Builder / address</th>
            <th className="px-2 py-1.5">Type</th>
            <th className="px-2 py-1.5">Crew</th>
            <th className="px-2 py-1.5">Super</th>
            <th className="px-2 py-1.5 text-right">Pay out</th>
            <th className="px-2 py-1.5 text-right">Sell</th>
            <th className="px-2 py-1.5">Status</th>
            <th className="px-2 py-1.5" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((l) => {
            const margin = l.sell && l.payout != null ? l.sell - l.payout : null;
            return (
              <tr key={l.id} className="align-top">
                <td className="px-2 py-1.5 text-xs whitespace-nowrap tabular-nums">
                  {day(l.startDate)}
                  {l.estimateNo && <div className="text-muted-foreground">{l.estimateNo}</div>}
                </td>
                <td className="px-2 py-1.5">
                  <Link href={`/production/${l.id}`} className="font-medium text-btr-link hover:underline">
                    {l.location ?? l.builder}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {[l.market === "COMMERCIAL" ? l.project : l.builder, l.model, showGroup ? l.grp : null].filter(Boolean).join(" · ")}
                  </div>
                  {l.notes && (
                    <div className="line-clamp-1 text-xs text-muted-foreground" title={l.notes}>
                      {l.notes}
                    </div>
                  )}
                </td>
                <td className="px-2 py-1.5 text-xs">{l.type}</td>
                <td className="px-2 py-1.5 text-xs">{l.crew}</td>
                <td className="px-2 py-1.5 text-xs">{l.superName}</td>
                <td className="px-2 py-1.5 text-right text-xs tabular-nums">
                  {usd(l.payout)}
                  {l.paidToDate != null && l.market === "COMMERCIAL" && <div className="text-muted-foreground">paid {usd(l.paidToDate)}</div>}
                </td>
                <td className="px-2 py-1.5 text-right text-xs tabular-nums">
                  {usd(l.sell)}
                  {margin != null && <div className={margin < 0 ? "text-red-700" : "text-muted-foreground"}>{usd(margin)}</div>}
                </td>
                <td className="px-2 py-1.5">
                  <Status l={l} />
                </td>
                <td className="px-2 py-1.5">
                  <Steps l={l} billing={billing} />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="bg-muted/30 text-xs">
          <tr>
            <td className="px-2 py-1.5" colSpan={5}>
              {rows.length} line{rows.length === 1 ? "" : "s"}
            </td>
            <td className="px-2 py-1.5 text-right font-medium tabular-nums">{usd(pay)}</td>
            <td className="px-2 py-1.5 text-right font-medium tabular-nums">{usd(sell)}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function grouped(rows: ProdLine[], key: (l: ProdLine) => string) {
  const m = new Map<string, ProdLine[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return [...m.entries()];
}

export default async function ProductionBoard({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const scope = await pmScope(user.id);
  const views = VIEWS.filter(([k]) => k !== "mine" || scope);
  const view = views.some(([k]) => k === sp.v) ? sp.v! : scope ? "mine" : "full";
  const market = sp.m === "res" ? "RESIDENTIAL" : sp.m === "comm" ? "COMMERCIAL" : null;
  const q = sp.q?.trim() ?? "";
  const billing = (BILLING_ROLES as readonly string[]).includes(user.role);
  const canEdit = user.role !== "VIEWER";
  const base: Prisma.ProdLineWhereInput[] = [];
  if (market) base.push({ market });
  if (q) base.push(search(q));
  const order: Prisma.ProdLineOrderByWithRelationInput[] = [{ startDate: { sort: "asc", nulls: "last" } }, { sourceTab: "asc" }, { sourceRow: "asc" }];
  const settings = await getSettings();

  // people pickers come from the schedule itself plus Crews & subs
  const [crewNames, superNames] = await Promise.all([
    prisma.prodLine.groupBy({ by: ["crew"], where: { ...OPEN, crew: { not: null } }, _count: true }),
    prisma.prodLine.groupBy({ by: ["superName"], where: { ...OPEN, superName: { not: null } }, _count: true }),
  ]);
  const crews = crewNames.sort((a, b) => b._count - a._count).map((c) => c.crew!);
  const supers = superNames.sort((a, b) => b._count - a._count).map((c) => c.superName!);

  let body: React.ReactNode = null;
  if (view === "full" || view === "mine") {
    const rows = await prisma.prodLine.findMany({ where: { AND: [OPEN, ...base, ...(view === "mine" && scope ? [mineWhere(scope)] : [])] }, orderBy: order, take: q ? 400 : 3000 });
    const newOnes = rows.filter((r) => r.board === "ADD");
    const sections = (["UPCOMING", "CURRENT", "WARRANTY"] as const).map((b) => [b, rows.filter((r) => r.board === b)] as const);
    body = (
      <>
        {newOnes.length > 0 && (
          <section className="flex flex-col gap-1.5">
            <h2 className="font-semibold text-amber-800">New — to be placed on the schedule ({newOnes.length})</h2>
            <Table rows={newOnes} billing={billing} showGroup />
          </section>
        )}
        {sections.map(([b, list]) =>
          list.length ? (
            <section key={b} className="flex flex-col gap-2">
              <h2 className="font-semibold">{b === "UPCOMING" ? "Upcoming" : b === "CURRENT" ? "Current" : "Warranty & service"}</h2>
              {grouped(list, (l) => (l.market === "COMMERCIAL" ? `Commercial · ${l.grp ?? ""} · ${l.project ?? ""}` : `${l.grp ?? "Residential"}${l.section ? ` · ${l.section}` : ""}`)).map(([g, rs]) => (
                <details key={g} open={!q ? rs.length <= 40 : true} className="rounded-md">
                  <summary className="cursor-pointer py-1 text-sm font-medium">
                    {g} <span className="text-muted-foreground">({rs.length})</span>
                  </summary>
                  <Table rows={rs} billing={billing} />
                </details>
              ))}
            </section>
          ) : null,
        )}
      </>
    );
  } else if (view === "crew" || view === "pm") {
    const list = view === "crew" ? crews : supers;
    const who = sp.who && list.includes(sp.who) ? sp.who : list[0];
    const [rows, crewRec] = await Promise.all([
      who ? prisma.prodLine.findMany({ where: { AND: [OPEN, ...base, view === "crew" ? { crew: who } : { superName: who }] }, orderBy: order }) : [],
      view === "crew" && who ? prisma.crew.findFirst({ where: { name: who }, select: { trade: true } }) : null,
    ]);
    body = (
      <div className="flex flex-col gap-3">
        {list.length > 0 && (
          <label className="flex items-center gap-2 text-sm">
            {view === "crew" ? "Crew" : "Project manager"}
            <NavSelect
              label={view === "crew" ? "Crew" : "Project manager"}
              value={who ? ((n: string) => `/production?v=${view}&who=${encodeURIComponent(n)}${market ? `&m=${sp.m}` : ""}`)(who) : ""}
              className="w-full max-w-md"
              options={list.map((n) => ({ label: n, href: `/production?v=${view}&who=${encodeURIComponent(n)}${market ? `&m=${sp.m}` : ""}` }))}
            />
            <span className="text-xs text-muted-foreground">{list.length} with open work</span>
          </label>
        )}
        <section className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">
              {who ? `${who}'s schedule` : "No one on the schedule yet"}
              {view === "crew" && who && (
                <Link href="/production/who" className="ml-2 text-xs font-normal text-muted-foreground hover:underline">
                  {crewRec?.trade ? `Does: ${crewRec.trade}` : "Work scope not set — add it"}
                </Link>
              )}
            </h2>
            {who && canEdit && (
              <Link href={`/production/new?${view === "crew" ? "crew" : "superName"}=${encodeURIComponent(who)}`} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
                Add to {view === "crew" ? "this crew's" : "this PM's"} schedule
              </Link>
            )}
          </div>
          <Table rows={rows} billing={billing} showGroup />
        </section>
      </div>
    );
  } else if (view === "billing") {
    const [toPay, toBill, waiting] = await Promise.all([
      prisma.prodLine.findMany({ where: { AND: [...base, { completed: { not: null } }, { approved: null }, { board: { not: "COMPLETED" } }] }, orderBy: { updatedAt: "desc" }, take: 300 }),
      prisma.prodLine.findMany({ where: { AND: [...base, { market: "RESIDENTIAL" }, { completed: { not: null } }, { billed: null }, { board: { not: "COMPLETED" } }] }, orderBy: { updatedAt: "desc" }, take: 300 }),
      prisma.prodLine.findMany({ where: { AND: [...base, { market: "RESIDENTIAL" }, { billed: { not: null } }, { btrPaid: null }, { board: { not: "COMPLETED" } }] }, orderBy: { billedAt: "asc" }, take: 300 }),
    ]);
    body = (
      <>
        <section className="flex flex-col gap-1.5">
          <h2 className="font-semibold">Crews to pay — marked completed ({toPay.length})</h2>
          <Table rows={toPay} billing={billing} showGroup />
        </section>
        <section className="flex flex-col gap-1.5">
          <h2 className="font-semibold">Residential to bill ({toBill.length}) <span className="text-sm font-normal text-muted-foreground">— commercial bills through <Link href="/billing/pay-apps" className="text-btr-link hover:underline">pay applications</Link></span></h2>
          <Table rows={toBill} billing={billing} showGroup />
        </section>
        <section className="flex flex-col gap-1.5">
          <h2 className="font-semibold">Billed — waiting on payment ({waiting.length})</h2>
          <Table rows={waiting} billing={billing} showGroup />
        </section>
      </>
    );
  } else {
    const rows = await prisma.prodLine.findMany({ where: { AND: [{ board: "COMPLETED" }, ...base] }, orderBy: [{ paidAt: { sort: "desc", nulls: "last" } }, { sourceRow: "asc" }], take: q || sp.all ? 1000 : 150 });
    body = (
      <section className="flex flex-col gap-1.5">
        <h2 className="font-semibold">Completed {q ? "matching your search" : "(latest 150 — search to find older)"}</h2>
        <Table rows={rows} billing={billing} showGroup />
      </section>
    );
  }

  const tabLink = (v: string) => `/production?v=${v}${market ? `&m=${sp.m}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const synced = settings.prodSyncedAt ? new Date(settings.prodSyncedAt) : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Schedule</h1>
          <p className="text-sm text-muted-foreground">
            {settings.prodSheetOff
              ? `${appName()} is the schedule.`
              : `Synced from the Residential and Commercial live sheets${synced ? ` · last ${synced.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : " · not synced yet"}.`}{" "}
            Press <b>Completed</b> when the crew is done — the office gets a note that the crew can be paid.{" "}
            <Link href="/schedule" className="text-btr-link hover:underline">
              Calendar view
            </Link>{" "}
            ·{" "}
            <Link href="/billing/pay-apps" className="text-btr-link hover:underline">
              Pay applications (AIA)
            </Link>{" "}
            ·{" "}
            <Link href="/production/who" className="text-btr-link hover:underline">
              Who does what (PMs, builders, crew scopes)
            </Link>
          </p>
        </div>
        {canEdit && (
          <Link href="/production/new" className="rounded-md bg-btr-blue px-3 py-2 text-sm font-medium text-white hover:bg-btr-blue-dark">
            Add a job to the schedule
          </Link>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b">
        {views.map(([k, l]) => (
          <Link key={k} href={tabLink(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${view === k ? "border-btr-blue" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {l}
          </Link>
        ))}
        <form className="ml-auto flex items-center gap-2 pb-1.5">
          <input type="hidden" name="v" value={view} />
          <select name="m" defaultValue={sp.m ?? ""} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
            <option value="">Residential + commercial</option>
            <option value="res">Residential</option>
            <option value="comm">Commercial</option>
          </select>
          <input name="q" defaultValue={q} placeholder="Search address, builder, crew…" className="h-8 w-56 rounded-md border border-input bg-background px-2 text-sm" />
          <button className="h-8 rounded-md border px-2 text-sm hover:bg-muted">Go</button>
        </form>
      </div>
      {body}
      {canEdit && !settings.prodSheetOff && (
        <section className="flex flex-col gap-2 rounded-md border p-3">
          <h2 className="text-sm font-semibold">Live sheet sync</h2>
          <p className="text-xs text-muted-foreground">Reads both schedules every 30 minutes (crews, payout, sell, AIA pay apps). A line edited here stays as edited.</p>
          <ProdSyncButton />
        </section>
      )}
      {user.role === "ADMIN" && (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-semibold">Sheet settings (Admin)</summary>
          <div className="mt-2">
            <ProdSheetSettings res={settings.prodResSheet ?? DEFAULT_RES_SHEET} comm={settings.prodCommSheet ?? DEFAULT_COMM_SHEET} off={!!settings.prodSheetOff} />
          </div>
        </details>
      )}
    </div>
  );
}
