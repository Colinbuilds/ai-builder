import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { STAFF_ROLES } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { PROPERTY_TYPES, RELATIONSHIPS, TIMELINES, WANTS, requestUrl, type Photo, type Rendering, type Want } from "@/lib/leads/web";
import { renderProvider } from "@/lib/render";
import { CopyButton } from "@/components/copy-button";
import { assignAction, closeAction, inspectionAction, managerAction } from "./actions";

const TABS = { new: "Needs a salesperson", assigned: "Inspection not set", scheduled: "Inspection set", all: "All" } as const;
type Tab = keyof typeof TABS;
const STATUS: Record<Tab, Prisma.WebLeadWhereInput> = { new: { status: "NEW" }, assigned: { status: "ASSIGNED" }, scheduled: { status: "SCHEDULED" }, all: {} };

function age(d: Date) {
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} hr ago`;
  return `${Math.round(m / 1440)} days ago`;
}

export default async function WebLeads({ searchParams }: { searchParams: Promise<{ tab?: string; mine?: string; err?: string }> }) {
  const u = await requireUser(STAFF_ROLES);
  const sp = await searchParams;
  const tab: Tab = sp.tab && sp.tab in TABS ? (sp.tab as Tab) : "new";
  const mine = sp.mine === "1";
  const [s, reps, counts] = await Promise.all([
    getSettings(),
    prisma.user.findMany({ where: { role: { in: ["ADMIN", "ESTIMATOR"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    Promise.all((["new", "assigned", "scheduled"] as Tab[]).map((t) => prisma.webLead.count({ where: STATUS[t] }))),
  ]);
  const leads = await prisma.webLead.findMany({ where: { ...STATUS[tab], ...(mine ? { assignedToId: u.id } : {}) }, orderBy: { createdAt: tab === "all" || tab === "scheduled" ? "desc" : "asc" }, take: 100 });
  const repName = new Map(reps.map((r) => [r.id, r.name]));
  const link = requestUrl("").replace(/\/$/, "") || "/quote";
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Website requests</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Customers fill in the request form with photos, try looks on their own home, and land here as new jobs. The sales manager assigns a salesperson; the salesperson calls and sets the
            inspection. Speed wins — call within the hour.
          </p>
        </div>
        <div className="flex flex-col gap-1 rounded-lg border bg-background p-2 text-sm">
          <span className="text-xs text-muted-foreground">Customer link (put it on the website, Google profile, yard signs, emails)</span>
          <span className="flex items-center gap-2">
            <code className="rounded bg-muted px-1.5 py-0.5">{link}</code>
            <CopyButton text={link} />
            <a href="/quote" target="_blank" className="text-xs text-btr-link hover:underline">
              open
            </a>
          </span>
          {!renderProvider() && <span className="text-xs text-amber-800">Renderings are off until a GEMINI_API_KEY or OPENAI_API_KEY is added — customers can still save their color picks.</span>}
        </div>
      </div>
      {sp.err && <p className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-800">{sp.err}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap gap-1 border-b text-sm">
          {(Object.keys(TABS) as Tab[]).map((k, i) => (
            <Link key={k} href={`/leads/web?tab=${k}${mine ? "&mine=1" : ""}`} className={`-mb-px border-b-2 px-3 py-1.5 ${tab === k ? "border-btr-blue font-medium" : "border-transparent text-muted-foreground"}`}>
              {TABS[k]}
              {i < 3 && counts[i] > 0 && <span className={`ml-1 rounded-full px-1.5 text-xs ${i === 0 ? "bg-btr-blue text-white" : "bg-muted"}`}>{counts[i]}</span>}
            </Link>
          ))}
        </nav>
        <Link href={`/leads/web?tab=${tab}${mine ? "" : "&mine=1"}`} className="text-sm text-btr-link hover:underline">
          {mine ? "Show everyone's" : "Only mine"}
        </Link>
      </div>

      <div className="flex flex-col gap-3">
        {leads.map((l) => {
          const photos = l.photos as Photo[];
          const renders = (l.renderings as Rendering[] | null) ?? [];
          const fav = renders.filter((r) => r.favorite);
          return (
            <article key={l.id} className={`flex flex-col gap-3 rounded-lg border bg-background p-3 lg:flex-row ${l.status === "NEW" && Date.now() - l.createdAt.getTime() > 3_600_000 ? "border-red-300" : ""}`}>
              <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <h2 className="text-base font-semibold">
                    {l.firstName} {l.lastName}
                  </h2>
                  <span className="text-xs text-muted-foreground">{age(l.createdAt)}</span>
                  {l.insurance && <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-900">insurance claim</span>}
                  {l.timeline === "ASAP" && <span className="rounded bg-red-100 px-1.5 text-xs text-red-800">ASAP</span>}
                </div>
                <div className="flex flex-wrap gap-x-3">
                  <a href={`tel:${l.phone.replace(/\D/g, "")}`} className="text-btr-link">
                    {l.phone}
                  </a>
                  <a href={`mailto:${l.email}`} className="text-btr-link">
                    {l.email}
                  </a>
                  <span className="text-muted-foreground">
                    prefers {l.contactPref === "TEXT" ? `text${l.textOk ? "" : " (no texting consent)"}` : l.contactPref === "EMAIL" ? "email" : "a call"}
                  </span>
                </div>
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${l.street}, ${l.city}, ${l.state} ${l.zip}`)}`} target="_blank" rel="noreferrer" className="text-btr-link">
                  {l.street}, {l.city}, {l.state} {l.zip}
                </a>
                <p>
                  <b>{(l.workTypes as string[]).map((w) => WANTS[w as Want]?.label ?? w).join(", ")}</b> · {PROPERTY_TYPES[l.propertyType as keyof typeof PROPERTY_TYPES]} ·{" "}
                  {RELATIONSHIPS[l.relationship as keyof typeof RELATIONSHIPS]}
                  {l.stories && ` · ${l.stories}`}
                  {l.currentRoof && ` · roof: ${l.currentRoof}`}
                  {l.roofAge && ` · ${l.roofAge} old`}
                  {l.timeline && ` · ${TIMELINES[l.timeline as keyof typeof TIMELINES]}`}
                </p>
                {l.insurance && (
                  <p className="text-xs">
                    Insurance: {l.insuranceCarrier ?? "carrier not given"}
                    {l.claimNumber && ` · claim ${l.claimNumber}`}
                    {l.dateOfLoss && ` · storm ${l.dateOfLoss.toISOString().slice(0, 10)}`}
                  </p>
                )}
                <p className="rounded bg-muted/50 p-2 whitespace-pre-wrap">&ldquo;{l.description}&rdquo;</p>
                {l.inspectionTimes && <p>Best times: {l.inspectionTimes}</p>}
                {renders.length > 0 && (
                  <p className="text-xs">
                    Looks tried: {renders.length}
                    {fav.length > 0 && <b> · likes: {fav.map((r) => r.label).join("; ")}</b>}
                  </p>
                )}
                <div className="flex flex-wrap gap-x-3 text-xs">
                  {l.projectId && (
                    <Link href={`/projects/${l.projectId}`} className="text-btr-link hover:underline">
                      Open the job →
                    </Link>
                  )}
                  <a href={`/quote/${l.token}`} target="_blank" className="text-btr-link hover:underline">
                    Customer&apos;s page
                  </a>
                  {l.heardFrom && <span className="text-muted-foreground">Heard from: {l.heardFrom}</span>}
                </div>
              </div>

              <div className="flex shrink-0 flex-col gap-2 lg:w-80">
                <div className="flex gap-1 overflow-x-auto">
                  {photos.map((_, i) => (
                    <a key={`p${i}`} href={`/api/q/${l.token}/photo/${i}`} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/q/${l.token}/photo/${i}?w=200`} alt="Customer photo" className="h-16 w-16 rounded object-cover" />
                    </a>
                  ))}
                  {renders.map((r, i) =>
                    r.url ? (
                      <a key={`r${i}`} href={`/api/q/${l.token}/render/${i}`} target="_blank" rel="noreferrer" title={r.label}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/q/${l.token}/render/${i}?w=200`} alt={r.label} className={`h-16 w-16 rounded object-cover ${r.favorite ? "ring-2 ring-btr-blue" : ""}`} />
                      </a>
                    ) : null,
                  )}
                </div>
                <form action={assignAction} className="flex gap-1">
                  <input type="hidden" name="id" value={l.id} />
                  <select name="salespersonId" defaultValue={l.assignedToId ?? ""} className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-1 text-sm">
                    <option value="" disabled>
                      Assign a salesperson…
                    </option>
                    {reps.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <button className="h-9 rounded-md bg-btr-blue px-3 text-sm text-white hover:bg-btr-blue-dark">{l.assignedToId ? "Reassign" : "Assign"}</button>
                </form>
                {l.assignedToId && (
                  <p className="text-xs text-muted-foreground">
                    {repName.get(l.assignedToId) ?? "Someone"} · assigned by {l.assignedBy} {l.assignedAt ? age(l.assignedAt) : ""}
                  </p>
                )}
                {l.status === "SCHEDULED" && l.inspectionAt ? (
                  <p className="rounded bg-green-50 p-2 text-sm text-green-900 dark:bg-green-950/30 dark:text-green-200">
                    Inspection {l.inspectionAt.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })}
                    {l.inspectionWhen && ` at ${l.inspectionWhen}`}
                  </p>
                ) : null}
                {l.assignedToId && l.status !== "CLOSED" && (
                  <form action={inspectionAction} className="flex flex-wrap gap-1">
                    <input type="hidden" name="id" value={l.id} />
                    <input name="date" type="date" min={today} required className="h-9 rounded-md border border-input bg-background px-1 text-sm" />
                    <input name="time" type="time" step={900} className="h-9 rounded-md border border-input bg-background px-1 text-sm" />
                    <button className="h-9 rounded-md border px-2 text-sm hover:bg-muted">{l.status === "SCHEDULED" ? "Move inspection" : "Set inspection"}</button>
                  </form>
                )}
                {l.status !== "CLOSED" && (
                  <form action={closeAction}>
                    <input type="hidden" name="id" value={l.id} />
                    <button className="text-xs text-muted-foreground hover:underline">Close (spam, duplicate or not a fit)</button>
                  </form>
                )}
              </div>
            </article>
          );
        })}
        {!leads.length && <p className="text-sm text-muted-foreground">Nothing here.</p>}
      </div>

      {u.role === "ADMIN" && (
        <form action={managerAction} className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-3 text-sm">
          <span className="font-medium">Sales manager</span>
          <span className="text-muted-foreground">(gets the &ldquo;assign a salesperson&rdquo; task and email for every new request; blank = every Admin)</span>
          <select name="salesManagerId" defaultValue={s.salesManagerId ?? ""} className="h-9 rounded-md border border-input bg-background px-1">
            <option value="">Every Admin</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button className="h-9 rounded-md border px-3 hover:bg-muted">Save</button>
        </form>
      )}
    </div>
  );
}
