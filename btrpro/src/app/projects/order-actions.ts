"use server";

import { PURCHASING_ROLES } from "@/lib/roles";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  addOrderLine,
  cancelOrder,
  confirmOrder,
  createOrder,
  receiveOrder,
  recordReturn,
  removeOrderLine,
  sendOrder,
  setLineQuantity,
  updateOrderDetails,
  type OrderActor,
} from "@/lib/orders/service";

export type OResult = {
  problems: string[];
  ok?: boolean;
  note?: string;
} | null;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => {
  const s = str(f, k).replace(/[,\s]/g, "");
  return s ? Number(s) : null;
};
const date = (f: FormData, k: string) =>
  str(f, k) ? new Date(`${str(f, k)}T12:00:00Z`) : null;

async function actor(): Promise<OrderActor> {
  const u = await requireUser(PURCHASING_ROLES);
  return { id: u.id, name: u.name, role: u.role };
}
async function run(
  f: FormData,
  fn: (a: OrderActor) => Promise<unknown>,
  note?: string,
): Promise<OResult> {
  const a = await actor();
  try {
    await fn(a);
  } catch (e) {
    return { problems: [msg(e)] };
  }
  revalidatePath(`/projects/${str(f, "projectId")}/orders`, "layout");
  return { problems: [], ok: true, note };
}

export async function createOrderAction(
  _: OResult,
  f: FormData,
): Promise<OResult> {
  const a = await actor();
  const projectId = str(f, "projectId");
  let id: string;
  try {
    id = (await createOrder(projectId, str(f, "estimateId") || null, a)).id;
  } catch (e) {
    return { problems: [msg(e)] };
  }
  redirect(`/projects/${projectId}/orders/${id}`);
}

export async function orderDetailsAction(
  _: OResult,
  f: FormData,
): Promise<OResult> {
  return run(f, (a) =>
    updateOrderDetails(
      str(f, "orderId"),
      {
        requestedDate: date(f, "requestedDate"),
        deliveryWindow: str(f, "deliveryWindow") || null,
        dropLocation: str(f, "dropLocation") || null,
        siteContact: str(f, "siteContact") || null,
        notes: str(f, "notes") || null,
      },
      a,
    ),
  );
}

export async function lineQtyAction(_: OResult, f: FormData): Promise<OResult> {
  return run(f, (a) =>
    setLineQuantity(str(f, "lineId"), num(f, "quantity"), a),
  );
}

export async function addOrderLineAction(
  _: OResult,
  f: FormData,
): Promise<OResult> {
  return run(f, (a) =>
    addOrderLine(
      str(f, "orderId"),
      {
        itemNumber: str(f, "itemNumber") || null,
        description: str(f, "description") || null,
        quantity: num(f, "quantity"),
        unit: str(f, "unit") || null,
      },
      a,
    ),
  );
}

export async function removeOrderLineAction(
  _: OResult,
  f: FormData,
): Promise<OResult> {
  return run(f, (a) => removeOrderLine(str(f, "lineId"), a));
}

export async function sendOrderAction(
  _: OResult,
  f: FormData,
): Promise<OResult> {
  const method = str(f, "method") === "EMAIL" ? "EMAIL" : "MANUAL";
  return run(
    f,
    (a) =>
      sendOrder(str(f, "orderId"), { method, to: str(f, "to") || null }, a),
    method === "EMAIL" ? "Emailed to the branch." : "Marked sent.",
  );
}

export async function confirmOrderAction(
  _: OResult,
  f: FormData,
): Promise<OResult> {
  return run(f, (a) =>
    confirmOrder(
      str(f, "orderId"),
      {
        supplierOrderNumber: str(f, "supplierOrderNumber") || null,
        confirmedDate: date(f, "confirmedDate"),
      },
      a,
    ),
  );
}

export async function receiveOrderAction(
  _: OResult,
  f: FormData,
): Promise<OResult> {
  const ids = f.getAll("lineId").map(String);
  const rec = f.getAll("received").map(String);
  const bo = f.getAll("backordered").map(String);
  const boDates = f.getAll("backorderDate").map(String);
  const file = f.get("file");
  return run(f, async (a) =>
    receiveOrder(
      str(f, "orderId"),
      {
        date: date(f, "date") ?? new Date(),
        ticketNumber: str(f, "ticketNumber") || null,
        note: str(f, "note") || null,
        lines: ids.map((id, i) => ({
          id,
          received: Number(rec[i] || 0),
          backordered: Number(bo[i] || 0),
          backorderDate: boDates[i]
            ? new Date(`${boDates[i]}T12:00:00Z`)
            : null,
        })),
        file:
          file instanceof File && file.size
            ? {
                bytes: new Uint8Array(await file.arrayBuffer()),
                name: file.name,
                type: file.type || null,
              }
            : null,
      },
      a,
    ),
  );
}

export async function returnAction(_: OResult, f: FormData): Promise<OResult> {
  return run(f, (a) =>
    recordReturn(str(f, "lineId"), num(f, "qty") ?? NaN, str(f, "reason"), a),
  );
}

export async function cancelOrderAction(
  _: OResult,
  f: FormData,
): Promise<OResult> {
  return run(f, (a) => cancelOrder(str(f, "orderId"), str(f, "reason"), a));
}
