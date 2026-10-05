// ABC Supply connection: once an Admin signs in with BTR's ABC account (Connections page), BTRpro reads order
// history and invoices in the background every 30 minutes. Each run also refreshes the sign-in, so it never hits
// ABC's 30-day idle limit. Endpoints: apidocs.abcsupply.com (Order History, Invoice History).
import { prisma } from "@/lib/db";
import { getSettings, saveSettings } from "@/lib/settings";
import { ABC_API, accessToken, getConnection, oauthConfigured } from "./oauth";
import { shortName } from "@/lib/company-profile";

const SYSTEM = { id: "", name: "ABC Supply sync" };
const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null || v === "" ? null : String(v));
const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const date = (v: unknown) => {
  const d = v ? new Date(String(v)) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};
const rowsOf = (j: Row): Row[] => {
  for (const k of ["items", "invoices", "orders", "data"]) if (Array.isArray(j[k])) return j[k] as Row[];
  return Array.isArray(j) ? (j as Row[]) : [];
};

async function getPages(path: string, query: Record<string, string>, token: string, maxPages = 20) {
  const out: Row[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const q = new URLSearchParams({ ...query, itemsPerPage: "100", pageNumber: String(page) });
    const res = await fetch(`${ABC_API()}${path}?${q}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    if (res.status === 401 || res.status === 403) throw new Error(`ABC Supply refused the request (${res.status}). Check the account's API access, then reconnect.`);
    if (!res.ok) throw new Error(`ABC Supply error ${res.status} on ${path}.`);
    const j = (await res.json()) as Row;
    const rows = rowsOf(j);
    out.push(...rows);
    const pages = num((j.pagination as Row | undefined)?.totalPages) ?? 1;
    if (page >= pages || !rows.length) break;
  }
  return out;
}

/** Finds the BTRpro job an ABC order/invoice belongs to: QuickBooks job number, then job name, then address. */
async function matchJob(po: string | null, jobName: string | null) {
  for (const v of [po, jobName].filter((x): x is string => !!x && x.trim().length >= 3)) {
    const t = v.trim();
    const hit = await prisma.project.findFirst({ where: { OR: [{ qboJobNo: t }, { name: t }, { address: { startsWith: t } }] }, select: { id: true } });
    if (hit) return hit.id;
  }
  return null;
}

async function upsert(kind: "ORDER" | "INVOICE", r: Row) {
  const externalId = str(kind === "ORDER" ? r.orderNumber : r.invoiceNumber);
  if (!externalId) return false;
  const po = str(r.purchaseOrderNumber ?? r.poNumber);
  const jobName = str(r.orderName ?? r.jobName);
  const data = {
    number: externalId,
    date: date(kind === "ORDER" ? (r.orderDate ?? r.invoiceDate) : (r.invoiceDate ?? r.orderDate)),
    poNumber: po,
    jobName,
    status: str(r.orderStatus ?? r.status),
    branch: str(r.branchCityState ?? r.branch),
    total: num(r.total ?? r.invoiceTotal),
    raw: r as object,
    projectId: await matchJob(po, jobName),
  };
  await prisma.supplierFeed.upsert({
    where: { provider_kind_externalId: { provider: "ABC_SUPPLY", kind, externalId } },
    create: { provider: "ABC_SUPPLY", kind, externalId, ...data },
    update: data,
  });
  return true;
}

export type AbcSync = { orders: number; invoices: number; note?: string };

export async function syncAbc(days = 90): Promise<AbcSync> {
  if (!(await getConnection("ABC_SUPPLY", ""))) throw new Error("ABC Supply isn't connected.");
  const { token } = await accessToken("ABC_SUPPLY", "");
  const s = await getSettings();
  const end = new Date();
  const start = new Date(end.getTime() - days * DAY);
  try {
    let orders = 0;
    for (const r of await getPages("/api/order/v2/orders/orderHistory", { startDate: ymd(start), endDate: ymd(end) }, token)) if (await upsert("ORDER", r)) orders++;
    let invoices = 0;
    let note: string | undefined;
    if (s.abcBillTo) {
      const path = `/api/invoice/v1/invoices/history/${encodeURIComponent(s.abcBillTo)}`;
      for (const r of await getPages(path, { startDate: start.toISOString().slice(0, 19) + "Z", endDate: end.toISOString().slice(0, 19) + "Z" }, token)) if (await upsert("INVOICE", r)) invoices++;
    } else note = `Add ${shortName()}'s ABC bill-to account number to pull invoices.`;
    await saveSettings({ abcSyncedAt: new Date().toISOString(), abcSyncError: null }, SYSTEM);
    return { orders, invoices, note };
  } catch (e) {
    await saveSettings({ abcSyncError: e instanceof Error ? e.message : "Sync failed" }, SYSTEM);
    throw e;
  }
}

let watching = false;
/** Every 30 minutes while ABC is connected: pull the last 90 days and keep the sign-in fresh. */
export function startAbcWatcher(everyMs = 30 * 60_000) {
  if (watching) return;
  watching = true;
  const run = async () => {
    try {
      if (!oauthConfigured("ABC_SUPPLY") || !(await getConnection("ABC_SUPPLY", ""))) return;
      const r = await syncAbc();
      console.log(`[abc] ${r.orders} orders, ${r.invoices} invoices`);
    } catch (e) {
      console.error("[abc] sync failed:", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(run, 120_000);
  setInterval(run, everyMs);
}
