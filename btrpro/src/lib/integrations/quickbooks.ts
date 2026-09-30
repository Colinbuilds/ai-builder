import { prisma } from "@/lib/db";
import { accessToken, getConnection } from "./oauth";
import { getSettings } from "@/lib/settings";
import type { InvLine } from "@/lib/billing/math";

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
