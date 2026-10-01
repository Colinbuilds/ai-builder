// Reads BTR's Google Sheets job schedules (Residential + Commercial "Live" schedules) into jobs.
// Residential: one row per house (Builder · Address · Model · Type · Crew · Super · Sales Rep · … · Sell).
// Commercial: "GC - Project" in the Builder column, one row per building / line; rows are grouped into one job.
// Nothing is estimated: money is read as written, stage comes from the tab and the Completed/Billed/Paid columns.
import type { Tab } from "./xlsx";
import type { Scope } from "@/lib/projects/intake";

export type Stage =
  | "LEAD"
  | "ESTIMATING"
  | "SUBMITTED"
  | "SOLD"
  | "SCHEDULED"
  | "IN_PRODUCTION"
  | "COMPLETE"
  | "INVOICED"
  | "PAID"
  | "CLOSED"
  | "LOST";
export const STAGE_RANK: Record<Stage, number> = {
  LEAD: 0,
  ESTIMATING: 1,
  SUBMITTED: 2,
  SOLD: 3,
  SCHEDULED: 4,
  IN_PRODUCTION: 5,
  COMPLETE: 6,
  INVOICED: 7,
  PAID: 8,
  CLOSED: 9,
  LOST: -1,
};

export type ScheduleJob = {
  key: string; // stable across tabs, so a job moving Upcoming → Current → Completed is the same job
  market: "RESIDENTIAL" | "COMMERCIAL";
  account: string; // the builder / GC / customer as written
  name: string;
  address: string | null;
  type: string | null;
  scopes: Scope[];
  stage: Stage;
  estimateNo: string | null;
  builderJobNo: string | null;
  dateAdded: Date | null;
  salesRep: string | null;
  sell: number | null;
  details: string[];
  sources: string[];
};
export type TabReport = {
  name: string;
  used: boolean;
  reason: string;
  jobs: number;
};
export type ParsedSchedule = {
  tabs: TabReport[];
  jobs: ScheduleJob[];
  skipped: { source: string; reason: string }[];
};

// Tabs that aren't job lists (or repeat other tabs). Weekly Billing repeats rows from the builder tabs.
const SKIP_TAB =
  /data_source|quick links|aia|^wip$|material|dashboard|completed projects|^sheet\d+$|weekly billing/i;

export const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function parseMoney(s: string | null | undefined): number | null {
  const t = (s ?? "").trim();
  if (!t || t === "-" || /^\$?\s*-\s*$/.test(t)) return null;
  const neg = /\(.*\)/.test(t) || /^-|^\$\s*-|-\$/.test(t);
  const n = Number(t.replace(/[()$,\s-]/g, ""));
  return Number.isFinite(n) && /\d/.test(t) ? (neg ? -n : n) : null;
}

export function parseDate(s: string | null | undefined): Date | null {
  const t = (s ?? "").trim();
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const serial = Number(t); // Excel date serial
    if (serial > 30000 && serial < 60000)
      return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  }
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(Date.UTC(y, Number(m[1]) - 1, Number(m[2]), 12));
  return d.getUTCMonth() === Number(m[1]) - 1 ? d : null;
}

export function scopesFor(type: string | null): Scope[] {
  const t = norm(type);
  const out = new Set<Scope>();
  if (/roof|shingle|reroof|r and r/.test(t))
    out.add(
      /epdm|tpo|flat|low slope|parapet|membrane/.test(t)
        ? "LOW_SLOPE"
        : "STEEP",
    );
  if (/epdm|tpo|flat roof|parapet/.test(t)) out.add("LOW_SLOPE");
  if (/siding|soffit|fascia|trim|wrap|hardie|lp\b|vinyl/.test(t))
    out.add("SIDING");
  if (/\bdeck/.test(t)) out.add("DECK");
  if (/panel|metal wall/.test(t)) out.add("PANELS");
  return [...out];
}

const HEADERS: Record<string, string> = {
  "date added": "dateAdded",
  estimate: "estimate",
  "estimate wo": "estimate",
  project: "project",
  builder: "builder",
  address: "address",
  "building type": "buildingType",
  model: "model",
  type: "type",
  crew: "crew",
  super: "super",
  "sales rep": "salesRep",
  notes: "notes",
  completed: "completed",
  "pay out": "payout",
  "total payout": "payout",
  sell: "sell",
  "paid approved": "paidApproved",
  billed: "billed",
  "btr paid": "btrPaid",
  "billing notes": "billingNotes",
};

function headerMap(row: string[]): Map<string, number> | null {
  const m = new Map<string, number>();
  row.forEach((c, i) => {
    const k = HEADERS[norm(c)];
    if (k && !m.has(k)) m.set(k, i);
  });
  return m.has("builder") && (m.has("address") || m.has("buildingType"))
    ? m
    : null;
}

function residentialStage(
  tab: string,
  section: string,
  get: (k: string) => string,
): Stage {
  if (get("btrPaid")) return "PAID";
  if (get("billed") && !/^no\b/i.test(get("billed"))) return "INVOICED";
  if (get("completed") && !/^no\b/i.test(get("completed"))) return "COMPLETE";
  if (/complete/i.test(tab)) return "COMPLETE";
  if (/upcoming/i.test(section) || /^add to/i.test(tab)) return "SOLD";
  return "SCHEDULED";
}

const usd = (n: number | null) =>
  n == null
    ? null
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function parseSchedule(
  tabs: Tab[],
  opts: { market: "RESIDENTIAL" | "COMMERCIAL"; include?: string[] },
): ParsedSchedule {
  const reports: TabReport[] = [];
  const skipped: ParsedSchedule["skipped"] = [];
  const byKey = new Map<string, ScheduleJob>();
  const put = (j: ScheduleJob) => {
    const prev = byKey.get(j.key);
    if (!prev) return byKey.set(j.key, j);
    // Same job on two tabs: keep the one further along; remember both sources.
    const keep = STAGE_RANK[j.stage] > STAGE_RANK[prev.stage] ? j : prev;
    const other = keep === j ? prev : j;
    byKey.set(j.key, {
      ...keep,
      sources: [...keep.sources, ...other.sources],
      estimateNo: keep.estimateNo ?? other.estimateNo,
      dateAdded: keep.dateAdded ?? other.dateAdded,
    });
  };

  for (const tab of tabs) {
    const forced = opts.include?.includes(tab.name);
    if (!forced && SKIP_TAB.test(tab.name.trim())) {
      reports.push({
        name: tab.name,
        used: false,
        reason: /weekly billing/i.test(tab.name)
          ? "Repeats rows from other tabs"
          : "Not a job list",
        jobs: 0,
      });
      continue;
    }
    const hi = tab.rows.slice(0, 12).findIndex((r) => headerMap(r ?? []));
    if (hi < 0) {
      reports.push({
        name: tab.name,
        used: false,
        reason: "No Builder / Address header row",
        jobs: 0,
      });
      continue;
    }
    const cols = headerMap(tab.rows[hi])!;
    const commercial = opts.market === "COMMERCIAL";
    let section = "";
    let count = 0;
    const groups = new Map<string, ScheduleJob>();
    for (let i = hi + 1; i < tab.rows.length; i++) {
      const row = (tab.rows[i] ?? []).map((c) => (c ?? "").trim());
      if (!row.some(Boolean)) continue;
      const get = (k: string) => (cols.has(k) ? (row[cols.get(k)!] ?? "") : "");
      const src = `${tab.name} row ${i + 1}`;
      const builder = get("builder");
      const filled = row.filter(Boolean);

      if (!commercial) {
        const address = get("address");
        if (!builder || !address) {
          if (filled.length === 1) section = filled[0];
          else if (builder && !address && filled.length <= 2) section = builder;
          else
            skipped.push({
              source: src,
              reason: builder ? "No address" : "No builder",
            });
          continue;
        }
        if (/base plan|price ?book/i.test(section)) {
          skipped.push({
            source: src,
            reason: `Base-plan pricing (${section}), not a job`,
          });
          continue;
        }
        const type = get("type") || null;
        const est = get("estimate");
        const sell = parseMoney(get("sell"));
        const payout = parseMoney(get("payout"));
        put({
          key: `res|${norm(builder)}|${norm(address)}|${norm(type)}`,
          market: "RESIDENTIAL",
          account: builder,
          name: type ? `${address} — ${type}` : address,
          address,
          type,
          scopes: scopesFor(type),
          stage: residentialStage(tab.name, section, get),
          estimateNo: /est/i.test(est) ? est.replace(/\s+/g, " ") : null,
          builderJobNo: est && !/est/i.test(est) && /\d/.test(est) ? est : null,
          dateAdded: parseDate(get("dateAdded")),
          salesRep: get("salesRep") || null,
          sell,
          details: [
            get("model") && `Model: ${get("model")}`,
            get("crew") && `Crew: ${get("crew")}`,
            get("super") && `Super: ${get("super")}`,
            payout != null && `Crew payout: ${usd(payout)}`,
            get("notes") && `Notes: ${get("notes")}`,
            get("completed") && `Completed: ${get("completed")}`,
            get("billed") && `Billed: ${get("billed")}`,
            get("billingNotes") && `Billing notes: ${get("billingNotes")}`,
            section && `Schedule section: ${section}`,
          ].filter((x): x is string => !!x),
          sources: [src],
        });
        count++;
        continue;
      }

      // Commercial
      if (!builder) {
        if (filled.length === 1) section = filled[0];
        continue; // project total rows and blank separators
      }
      const bt = get("buildingType");
      const full = bt ? `${builder} - ${bt}` : builder;
      const dash = full.indexOf(" - ");
      const account = dash > 0 ? full.slice(0, dash).trim() : full.trim();
      const project = dash > 0 ? full.slice(dash + 3).trim() : full.trim();
      const key = `com|${norm(full)}`;
      const stage: Stage = /^current/i.test(tab.name)
        ? "IN_PRODUCTION"
        : /upcoming/i.test(tab.name)
          ? "SOLD"
          : /complete/i.test(tab.name)
            ? "COMPLETE"
            : "SCHEDULED";
      const sell = parseMoney(get("sell"));
      const payout = parseMoney(get("payout"));
      const line = [
        get("address") || bt,
        get("type"),
        get("crew"),
        payout != null && `payout ${usd(payout)}`,
        sell != null && `sell ${usd(sell)}`,
        get("notes"),
      ]
        .filter(Boolean)
        .join(" · ");
      const g = groups.get(key);
      if (g) {
        g.sell = sell == null ? g.sell : (g.sell ?? 0) + sell;
        if (line) g.details.push(line);
        g.sources.push(src);
        g.scopes = [...new Set([...g.scopes, ...scopesFor(get("type"))])];
        g.type =
          [...new Set([g.type, get("type")].filter(Boolean))].join(", ") ||
          null;
      } else {
        const est = get("estimate");
        groups.set(key, {
          key,
          market: "COMMERCIAL",
          account,
          name: project,
          address: null,
          type: get("type") || null,
          scopes: scopesFor(get("type")),
          stage,
          estimateNo: /est/i.test(est) ? est.replace(/\s+/g, " ") : null,
          builderJobNo: null,
          dateAdded: null,
          salesRep: get("salesRep") || null,
          sell,
          details: [
            ...(get("super") ? [`Super: ${get("super")}`] : []),
            ...(section ? [`Schedule section: ${section}`] : []),
            ...(line ? [line] : []),
          ],
          sources: [src],
        });
      }
    }
    for (const g of groups.values()) (put(g), count++);
    reports.push({ name: tab.name, used: true, reason: "", jobs: count });
  }
  return { tabs: reports, jobs: [...byKey.values()], skipped };
}

// ---- Account matching -------------------------------------------------------

export type Account = { id: string; name: string; type: string };
export type AccountMatch = { account: Account | null; ambiguous: Account[] };

const SUFFIX = new Set([
  "homes",
  "home",
  "builders",
  "builder",
  "building",
  "construction",
  "companies",
  "company",
  "inc",
  "llc",
  "co",
  "corp",
  "group",
]);
const plain = (s: string) =>
  norm(s.replace(/\([^)]*\)/g, " ")).replace(/^the /, "");
function core(s: string) {
  const w = plain(s).split(" ").filter(Boolean);
  while (w.length > 1 && SUFFIX.has(w[w.length - 1])) w.pop();
  return w.join(" ");
}
const paren = (s: string) => norm(s.match(/\(([^)]*)\)/)?.[1] ?? "");

/** Which account a schedule's Builder text belongs to: exact name, then name prefix ("DR Horton Westbrook Hills" → DR Horton), then core name. */
export function matchAccount(text: string, accounts: Account[]): AccountMatch {
  const t = plain(text);
  const tc = core(text);
  const tiers: ((a: Account) => boolean)[] = [
    (a) => plain(a.name) === t,
    (a) => !!plain(a.name) && t.startsWith(plain(a.name) + " "),
    (a) =>
      !!core(a.name) &&
      (core(a.name) === tc || t.startsWith(core(a.name) + " ")),
  ];
  for (const test of tiers) {
    let hits = accounts.filter(test);
    if (!hits.length) continue;
    const longest = Math.max(...hits.map((a) => plain(a.name).length));
    hits = hits.filter((a) => plain(a.name).length === longest);
    if (hits.length === 1) return { account: hits[0], ambiguous: [] };
    // Same builder in two markets, e.g. DR Horton (Omaha) / (Kansas City): pick the one named in the text, else Omaha (home market).
    // look in the text as written, parentheses included: "DR Horton (Kansas City)"
    const raw = ` ${norm(text)} `;
    const named = hits.filter(
      (a) => paren(a.name) && raw.includes(` ${paren(a.name)} `),
    );
    const pick =
      named[0] ?? hits.find((a) => /omaha/.test(paren(a.name))) ?? null;
    return { account: pick, ambiguous: hits };
  }
  return { account: null, ambiguous: [] };
}
