"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { BillError, approveBill, disputeBill, markBillPaid, openBill, refreshBill, reopenBill, scanBill, voidBill } from "@/lib/bills/service";
import { ReceiptError } from "@/lib/receipts/service";
import { CostError } from "@/lib/costing/service";
import { aiErrorMessage } from "@/lib/ai/claude";

export type BResult = { problems: string[]; ok?: boolean; note?: string; text?: string } | null;
const msg = (e: unknown) => (e instanceof BillError || e instanceof ReceiptError || e instanceof CostError ? e.message : aiErrorMessage(e));
const done = (id: string) => {
  revalidatePath(`/bills/${id}`);
  revalidatePath("/bills");
};

export async function scanBillAction(_: BResult, f: FormData): Promise<BResult> {
  const u = await requireUser(STAFF_ROLES);
  let id: string;
  try {
    const files = await Promise.all(
      f
        .getAll("files")
        .filter((x): x is File => x instanceof File && x.size > 0)
        .map(async (x) => ({ bytes: new Uint8Array(await x.arrayBuffer()), name: x.name || "invoice" })),
    );
    id = await scanBill(files, u);
  } catch (e) {
    return { problems: [msg(e)] };
  }
  redirect(`/bills/${id}`);
}

/** From a receipt that turns out to be an on-account invoice. */
export async function receiptToBillAction(f: FormData) {
  await requireUser(STAFF_ROLES);
  const id = await openBill(String(f.get("scanId")));
  redirect(`/bills/${id}`);
}

export async function setBillJobAction(f: FormData) {
  await requireUser(STAFF_ROLES);
  const id = String(f.get("id"));
  await refreshBill(id, String(f.get("projectId") ?? "") || null);
  done(id);
}

export async function recheckBillAction(f: FormData) {
  await requireUser(STAFF_ROLES);
  const id = String(f.get("id"));
  await refreshBill(id);
  done(id);
}

export async function approveBillAction(_: BResult, f: FormData): Promise<BResult> {
  const u = await requireUser(STAFF_ROLES);
  const id = String(f.get("id"));
  try {
    const b = await approveBill(id, String(f.get("note") ?? "").trim() || null, u);
    done(id);
    return { problems: [], ok: true, note: `Approved into job costs. ${b.qboStatus ?? ""}` };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}

export async function disputeBillAction(_: BResult, f: FormData): Promise<BResult> {
  const u = await requireUser(STAFF_ROLES);
  const id = String(f.get("id"));
  try {
    const r = await disputeBill(id, String(f.get("note") ?? ""), String(f.get("to") ?? "").trim() || null, u);
    done(id);
    return { problems: [], ok: true, note: r.sent ? "Held, and the supplier was emailed." : "Held. Copy the message below and send it to your rep.", text: r.text };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}

export async function reopenBillAction(f: FormData) {
  await requireUser(STAFF_ROLES);
  const id = String(f.get("id"));
  await reopenBill(id);
  done(id);
}

export async function voidBillAction(_: BResult, f: FormData): Promise<BResult> {
  const u = await requireUser(STAFF_ROLES);
  const id = String(f.get("id"));
  try {
    await voidBill(id, String(f.get("reason") ?? ""), u);
    done(id);
    return { problems: [], ok: true, note: "Voided." };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}

export async function paidBillAction(_: BResult, f: FormData): Promise<BResult> {
  const u = await requireUser(STAFF_ROLES);
  const id = String(f.get("id"));
  try {
    await markBillPaid(id, String(f.get("ref") ?? "").trim() || null, u);
    done(id);
    return { problems: [], ok: true, note: "Marked paid." };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}
