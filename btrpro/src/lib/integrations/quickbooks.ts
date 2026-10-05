import { prisma } from "@/lib/db";
import { accessToken, getConnection } from "./oauth";
import { getSettings } from "@/lib/settings";
import type { InvLine } from "@/lib/billing/math";
import { appName } from "@/lib/company-profile";

// QuickBooks Online push: customers, invoices, payments. Only runs when an Admin has connected
// BTR's QuickBooks company; otherwise the office keys them in (or exports) as before.

const BASE = () => (process.env.QBO_ENV === "sandbox" ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com");
export class QboError extends Error {}

export async function qboConnected() {
  return !!(await getConnection("QUICKBOOKS", ""));
}

async function qbo<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const { token, extra } = await accessToken("QUICKBOOKS", "");
  if (!extra.realmId) throw new QboError("QuickBooks connection has no company (realmId). Reconnect it.");
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE()}/v3/company/${extra.realmId}/${path}${sep}minorversion=75`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as { Fault?: { Error?: { Message?: string; Detail?: string }[] } } & T;
  if (!res.ok || json.Fault) {
    const e = json.Fault?.Error?.[0];
    throw new QboError(`QuickBooks ${res.status}: ${e?.Message ?? "error"}${e?.Detail ? ` — ${e.Detail}` : ""}`);
  }
  return json;
}

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** Finds or creates the QuickBooks customer for a job's bill-to, and remembers its id on the job. */
export async function ensureCustomer(projectId: string) {
  const p = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: { clientCompany: true, contacts: { where: { isPrimary: true }, include: { contact: true } } },
  });
  if (p.qboCustomerId) return p.qboCustomerId;
  const c = p.contacts[0]?.contact;
  // commercial: bill the company; residential: the homeowner, one customer per job address
  const name = (p.clientCompany?.name ?? (c ? `${c.firstName} ${c.lastName}${p.address ? ` - ${p.address}` : ""}` : p.name)).slice(0, 100);
  const found = await qbo<{ QueryResponse: { Customer?: { Id: string }[] } }>("GET", `query?query=${encodeURIComponent(`select Id from Customer where DisplayName = '${q(name)}'`)}`);
  let id = found.QueryResponse.Customer?.[0]?.Id;
  if (!id) {
    const email = p.clientCompany?.email ?? c?.email;
    const created = await qbo<{ Customer: { Id: string } }>("POST", "customer", {
      DisplayName: name,
      ...(email ? { PrimaryEmailAddr: { Address: email } } : {}),
      ...(p.address ? { BillAddr: { Line1: p.address } } : {}),
    });
    id = created.Customer.Id;
  }
  await prisma.project.update({ where: { id: projectId }, data: { qboCustomerId: id } });
  return id;
}

export async function syncInvoice(invoiceId: string) {
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  try {
    const s = await getSettings();
    if (!s.qboItemId) throw new QboError("Pick the QuickBooks item for invoice lines under Admin → Company settings.");
    if (inv.qboId) return inv.qboId;
    const customer = await ensureCustomer(inv.projectId);
    const line = (description: string, amount: number) => ({ Amount: amount, DetailType: "SalesItemLineDetail", Description: description, SalesItemLineDetail: { ItemRef: { value: s.qboItemId } } });
    const lines = (inv.lines as InvLine[]).map((l) => line(l.description, l.amount));
    if (inv.retainage) lines.push(line(`Retainage withheld (${inv.retainagePct}%)`, -inv.retainage));
    const r = await qbo<{ Invoice: { Id: string } }>("POST", "invoice", {
      CustomerRef: { value: customer },
      DocNumber: inv.number.slice(0, 21),
      TxnDate: inv.issueDate.toISOString().slice(0, 10),
      DueDate: inv.dueDate.toISOString().slice(0, 10),
      Line: lines,
    });
    await prisma.invoice.update({ where: { id: invoiceId }, data: { qboId: r.Invoice.Id, qboSyncedAt: new Date(), qboError: null } });
    return r.Invoice.Id;
  } catch (e) {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { qboError: e instanceof Error ? e.message : String(e) } });
    throw e;
  }
}

export async function syncPayment(paymentId: string) {
  const pay = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { invoice: true } });
  try {
    if (pay.qboId) return pay.qboId;
    const invQbo = pay.invoice.qboId ?? (await syncInvoice(pay.invoiceId));
    const customer = await ensureCustomer(pay.invoice.projectId);
    const r = await qbo<{ Payment: { Id: string } }>("POST", "payment", {
      CustomerRef: { value: customer },
      TotalAmt: pay.amount,
      TxnDate: pay.date.toISOString().slice(0, 10),
      ...(pay.reference ? { PaymentRefNum: pay.reference.slice(0, 21) } : {}),
      Line: [{ Amount: pay.amount, LinkedTxn: [{ TxnId: invQbo, TxnType: "Invoice" }] }],
    });
    await prisma.payment.update({ where: { id: paymentId }, data: { qboId: r.Payment.Id, qboError: null } });
    return r.Payment.Id;
  } catch (e) {
    await prisma.payment.update({ where: { id: paymentId }, data: { qboError: e instanceof Error ? e.message : String(e) } });
    throw e;
  }
}

async function ensureVendor(name: string) {
  const display = name.slice(0, 100);
  const found = await qbo<{ QueryResponse: { Vendor?: { Id: string }[] } }>("GET", `query?query=${encodeURIComponent(`select Id from Vendor where DisplayName = '${q(display)}'`)}`);
  return found.QueryResponse.Vendor?.[0]?.Id ?? (await qbo<{ Vendor: { Id: string } }>("POST", "vendor", { DisplayName: display })).Vendor.Id;
}

/** A change order goes to QuickBooks as an Estimate for the job's customer, one line per material. */
export async function pushChangeOrderEstimate(coId: string, lines: { description: string; amount: number }[]) {
  const s = await getSettings();
  if (!s.qboItemId) throw new QboError("Pick the QuickBooks item for lines under Admin → Company settings.");
  const co = await prisma.changeOrder.findUniqueOrThrow({ where: { id: coId } });
  const customer = await ensureCustomer(co.projectId);
  const r = await qbo<{ Estimate: { Id: string } }>("POST", "estimate", {
    CustomerRef: { value: customer },
    DocNumber: co.number.slice(0, 21),
    TxnDate: co.createdAt.toISOString().slice(0, 10),
    PrivateNote: co.description.slice(0, 4000),
    Line: lines.map((l) => ({ Amount: l.amount, DetailType: "SalesItemLineDetail", Description: l.description.slice(0, 4000), SalesItemLineDetail: { ItemRef: { value: s.qboItemId } } })),
  });
  return r.Estimate.Id;
}

/** The receipt as an expense (Purchase) against the job's customer, so QuickBooks job-profit reports have the real cost. */
export async function pushReceiptExpense(input: { projectId: string; vendor: string; date: string | null; reference: string | null; lines: { description: string; amount: number }[] }) {
  const s = await getSettings();
  if (!s.qboExpenseAccountId || !s.qboPaymentAccountId) throw new QboError("Set the QuickBooks expense account and paid-from account under Admin → Company settings.");
  const [customer, vendor] = await Promise.all([ensureCustomer(input.projectId), ensureVendor(input.vendor)]);
  const r = await qbo<{ Purchase: { Id: string } }>("POST", "purchase", {
    PaymentType: "Cash",
    AccountRef: { value: s.qboPaymentAccountId },
    EntityRef: { value: vendor, type: "Vendor" },
    ...(input.date ? { TxnDate: input.date } : {}),
    ...(input.reference ? { DocNumber: input.reference.slice(0, 21) } : {}),
    Line: input.lines.map((l) => ({
      Amount: l.amount,
      DetailType: "AccountBasedExpenseLineDetail",
      Description: l.description.slice(0, 4000),
      AccountBasedExpenseLineDetail: { AccountRef: { value: s.qboExpenseAccountId }, CustomerRef: { value: customer }, BillableStatus: "NotBillable" },
    })),
  });
  return r.Purchase.Id;
}

/** An on-account supplier invoice as a QuickBooks Bill (accounts payable), job-costed to the job's customer. */
export async function pushSupplierBill(input: {
  projectId: string;
  vendor: string;
  invoiceNumber: string | null;
  date: string | null;
  dueDate: string | null;
  lines: { description: string; amount: number }[];
}) {
  const s = await getSettings();
  if (!s.qboExpenseAccountId) throw new QboError("Set the QuickBooks expense account under Admin → Company settings.");
  const [customer, vendor] = await Promise.all([ensureCustomer(input.projectId), ensureVendor(input.vendor)]);
  const r = await qbo<{ Bill: { Id: string } }>("POST", "bill", {
    VendorRef: { value: vendor },
    ...(input.date ? { TxnDate: input.date } : {}),
    ...(input.dueDate ? { DueDate: input.dueDate } : {}),
    ...(input.invoiceNumber ? { DocNumber: input.invoiceNumber.slice(0, 21) } : {}),
    Line: input.lines.map((l) => ({
      Amount: l.amount,
      DetailType: "AccountBasedExpenseLineDetail",
      Description: l.description.slice(0, 4000),
      AccountBasedExpenseLineDetail: { AccountRef: { value: s.qboExpenseAccountId }, CustomerRef: { value: customer }, BillableStatus: "NotBillable" },
    })),
  });
  return r.Bill.Id;
}

/** What's still owed on a bill in QuickBooks (0 = paid there). */
export async function qboBillBalance(billId: string) {
  const r = await qbo<{ Bill: { Balance: number } }>("GET", `bill/${encodeURIComponent(billId)}`);
  return r.Bill.Balance;
}

/**
 * The job's QuickBooks number: makes the customer and an opening estimate in QuickBooks and keeps its number
 * on the job ("est 6024" on the schedule). Numbers follow the highest estimate number already in QuickBooks.
 * Does nothing (returns null) when QuickBooks isn't connected; never makes a second estimate for a job.
 */
export async function ensureJobNumber(projectId: string): Promise<string | null> {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { qboJobNo: true, name: true, address: true } });
  if (p.qboJobNo) return p.qboJobNo;
  if (!(await qboConnected())) return null;
  const s = await getSettings();
  if (!s.qboItemId) throw new QboError("Pick the QuickBooks item for lines under Admin → Company settings.");
  const customer = await ensureCustomer(projectId);
  const recent = await qbo<{ QueryResponse: { Estimate?: { DocNumber?: string }[] } }>("GET", `query?query=${encodeURIComponent("select DocNumber from Estimate orderby MetaData.CreateTime desc maxresults 100")}`);
  const top = Math.max(0, ...(recent.QueryResponse.Estimate ?? []).map((e) => Number((e.DocNumber ?? "").replace(/\D/g, "")) || 0));
  const doc = String(top + 1);
  const r = await qbo<{ Estimate: { Id: string; DocNumber?: string } }>("POST", "estimate", {
    CustomerRef: { value: customer },
    DocNumber: doc,
    PrivateNote: `Opened in ${appName()}: ${p.name}${p.address ? ` — ${p.address}` : ""}`.slice(0, 4000),
    Line: [{ Amount: 0, DetailType: "SalesItemLineDetail", Description: "Job opened — pricing to follow", SalesItemLineDetail: { ItemRef: { value: s.qboItemId }, Qty: 1, UnitPrice: 0 } }],
  });
  const no = r.Estimate.DocNumber ?? doc;
  await prisma.project.update({ where: { id: projectId }, data: { qboEstimateId: r.Estimate.Id, qboJobNo: no } });
  await prisma.projectActivity.create({ data: { projectId, kind: "billing", text: `QuickBooks estimate #${no} created for this job` } });
  return no;
}
