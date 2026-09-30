"use client";

import { useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import {
  addOrderLineAction,
  cancelOrderAction,
  confirmOrderAction,
  createOrderAction,
  lineQtyAction,
  orderDetailsAction,
  receiveOrderAction,
  removeOrderLineAction,
  returnAction,
  sendOrderAction,
  type OResult,
} from "@/app/projects/order-actions";
import { ItemPicker } from "@/components/estimates/item-picker";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";

const Ok = ({ s, text = "Saved." }: { s: OResult; text?: string }) => (s?.ok ? <span className="text-sm text-green-700 dark:text-green-400">{s.note ?? text}</span> : null);
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");
type Ids = { projectId: string; orderId: string };
const Hidden = ({ projectId, orderId }: Ids) => (
  <>
    <input type="hidden" name="projectId" value={projectId} />
    <input type="hidden" name="orderId" value={orderId} />
  </>
);

export function NewOrder({ projectId, estimates }: { projectId: string; estimates: { id: string; label: string }[] }) {
  const [state, action, pending] = useFormAction(createOrderAction, null);
  return (
    <form onSubmit={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <Select name="estimateId" defaultValue={estimates[0]?.id ?? ""} className="w-72">
        {estimates.map((e) => (
          <option key={e.id} value={e.id}>
            From {e.label}
          </option>
        ))}
        <option value="">Blank order</option>
      </Select>
      <Button size="sm" disabled={pending}>
        New material order
      </Button>
      <Problems state={state} className="w-full" />
    </form>
  );
}

export function OrderDetails({
  ids,
  o,
  drops,
  windows,
  editable,
}: {
  ids: Ids;
  o: { requestedDate: Date | null; deliveryWindow: string | null; dropLocation: string | null; siteContact: string | null; notes: string | null };
  drops: readonly string[];
  windows: Record<string, string>;
  editable: boolean;
}) {
  const [state, action, pending] = useFormAction(orderDetailsAction, null);
  return (
    <form onSubmit={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Hidden {...ids} />
      <div className="flex flex-col gap-1">
        <Label>Delivery date</Label>
        <Input type="date" name="requestedDate" defaultValue={iso(o.requestedDate)} disabled={!editable} />
      </div>
      <div className="flex flex-col gap-1">
        <Label>Window</Label>
        <Select name="deliveryWindow" defaultValue={o.deliveryWindow ?? "ANYTIME"} disabled={!editable}>
          {Object.entries(windows).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label>Drop location</Label>
        <Select name="dropLocation" defaultValue={o.dropLocation ?? ""} disabled={!editable}>
          <option value="">Pick…</option>
          {drops.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label>On-site contact</Label>
        <Input name="siteContact" defaultValue={o.siteContact ?? ""} placeholder="Name + cell for the driver" disabled={!editable} />
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4">
        <Label>Notes for the branch</Label>
        <Input name="notes" defaultValue={o.notes ?? ""} placeholder="Gate code, overhead lines, set on the north side, call 30 min out…" disabled={!editable} />
      </div>
      {editable && (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={pending}>
            Save delivery details
          </Button>
          <Ok s={state} />
        </div>
      )}
      <Problems state={state} className="sm:col-span-2 lg:col-span-4" />
    </form>
  );
}

export function EditLineQty({ ids, lineId, quantity }: { ids: Ids; lineId: string; quantity: number | null }) {
  const [state, action, pending] = useFormAction(lineQtyAction, null);
  const [rState, rAction] = useFormAction(removeOrderLineAction, null);
  return (
    <div className="flex items-center gap-1">
      <form onSubmit={action} className="flex items-center gap-1">
        <Hidden {...ids} />
        <input type="hidden" name="lineId" value={lineId} />
        <Input name="quantity" defaultValue={quantity ?? ""} placeholder="MISSING" inputMode="decimal" className={`h-7 w-20 text-right ${quantity == null ? "border-red-400" : ""}`} />
        <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={pending}>
          set
        </Button>
      </form>
      <form onSubmit={rAction}>
        <Hidden {...ids} />
        <input type="hidden" name="lineId" value={lineId} />
        <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground">
          remove
        </Button>
      </form>
      <Problems state={state ?? rState} />
    </div>
  );
}

export function AddOrderLine({ ids }: { ids: Ids }) {
  const [state, action, pending] = useFormAction(addOrderLineAction, null, { resetOnOk: true });
  const [item, setItem] = useState<{ itemNumber: string | null; description?: string | null; uom?: string }>({ itemNumber: null });
  return (
    <form onSubmit={action} className="flex flex-col gap-2 rounded-md border p-3">
      <Hidden {...ids} />
      <input type="hidden" name="itemNumber" value={item.itemNumber ?? ""} />
      <ItemPicker value={item} label="Add from the price sheets" onPick={(it) => setItem(it ? { itemNumber: it.itemNumber, description: it.description, uom: it.uom } : { itemNumber: null })} />
      <div className="flex flex-wrap items-center gap-2">
        {!item.itemNumber && <Input name="description" placeholder="…or describe it (priced by the supplier)" className="h-8 min-w-60 flex-1" />}
        <Input name="quantity" placeholder="Qty" inputMode="decimal" className="h-8 w-20" required />
        {item.itemNumber ? <span className="text-sm text-muted-foreground">{item.uom}</span> : <Input name="unit" placeholder="Unit" className="h-8 w-20" />}
        <Button size="sm" variant="outline" disabled={pending}>
          Add line
        </Button>
      </div>
      <Problems state={state} />
    </form>
  );
}

export function SendOrder({ ids, problems, defaultTo, pdfHref }: { ids: Ids; problems: string[]; defaultTo: string | null; pdfHref: string }) {
  const [state, action, pending] = useFormAction(sendOrderAction, null);
  return (
    <form onSubmit={action} className="flex flex-col gap-2 rounded-md border p-3">
      <Hidden {...ids} />
      <p className="text-sm font-medium">Send to ABC</p>
      {problems.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-red-800 dark:text-red-300">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input name="to" type="email" defaultValue={defaultTo ?? ""} placeholder="Branch order email" className="w-64" />
        <Button size="sm" name="method" value="EMAIL" disabled={pending || problems.length > 0}>
          Email order PDF
        </Button>
        <span className="text-sm text-muted-foreground">or</span>
        <a href={pdfHref} className="text-sm underline" target="_blank">
          download the PDF
        </a>
        <Button size="sm" variant="outline" name="method" value="MANUAL" disabled={pending || problems.length > 0}>
          Mark as sent
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Sending files the PDF on the job and adds the order&apos;s priced total to committed cost in Job costing.</p>
      <Ok s={state} />
      <Problems state={state} />
    </form>
  );
}

export function ConfirmOrder({ ids, supplierOrderNumber, confirmedDate }: { ids: Ids; supplierOrderNumber: string | null; confirmedDate: Date | null }) {
  const [state, action, pending] = useFormAction(confirmOrderAction, null);
  return (
    <form onSubmit={action} className="flex flex-wrap items-end gap-2">
      <Hidden {...ids} />
      <div className="flex flex-col gap-1">
        <Label>ABC order #</Label>
        <Input name="supplierOrderNumber" defaultValue={supplierOrderNumber ?? ""} className="w-40" />
      </div>
      <div className="flex flex-col gap-1">
        <Label>Confirmed delivery</Label>
        <Input type="date" name="confirmedDate" defaultValue={iso(confirmedDate)} />
      </div>
      <Button size="sm" variant="outline" disabled={pending}>
        Save confirmation
      </Button>
      <Ok s={state} />
      <Problems state={state} className="w-full" />
    </form>
  );
}

type RLine = { id: string; description: string; itemNumber: string | null; quantity: number | null; unit: string | null; received: number; backordered: number; backorderDate: Date | null };
export function ReceiveOrder({ ids, lines }: { ids: Ids; lines: RLine[] }) {
  const [state, action, pending] = useFormAction(receiveOrderAction, null);
  return (
    <form onSubmit={action} className="flex flex-col gap-2 rounded-md border p-3">
      <Hidden {...ids} />
      <p className="text-sm font-medium">Receive a delivery</p>
      <p className="text-xs text-muted-foreground">Enter the total received so far for each line (count against the ticket). Anything short and coming later is a backorder.</p>
      <div className="flex flex-wrap gap-2">
        <Input type="date" name="date" defaultValue={iso(new Date())} className="w-40" />
        <Input name="ticketNumber" placeholder="Delivery ticket #" className="w-44" />
        <Input name="file" type="file" accept="image/*,application/pdf" capture="environment" className="w-64" />
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="p-1">Item</th>
            <th className="p-1 text-right">Ordered</th>
            <th className="p-1">Received (total)</th>
            <th className="p-1">Backordered</th>
            <th className="p-1">Backorder due</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t">
              <td className="p-1">
                <input type="hidden" name="lineId" value={l.id} />
                {l.description} {l.itemNumber && <span className="font-mono text-xs text-muted-foreground">{l.itemNumber}</span>}
              </td>
              <td className="p-1 text-right tabular-nums">
                {l.quantity ?? "—"} {l.unit}
              </td>
              <td className="p-1">
                <Input name="received" defaultValue={l.received || (l.quantity ?? "")} inputMode="decimal" className="h-7 w-20" />
              </td>
              <td className="p-1">
                <Input name="backordered" defaultValue={l.backordered || ""} inputMode="decimal" className="h-7 w-20" />
              </td>
              <td className="p-1">
                <Input type="date" name="backorderDate" defaultValue={iso(l.backorderDate)} className="h-7 w-36" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Input name="note" placeholder="Note (damaged pallet, left at the curb…)" />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending}>
          Save delivery
        </Button>
        <Ok s={state} />
      </div>
      <Problems state={state} />
    </form>
  );
}

export function ReturnLine({ ids, lineId }: { ids: Ids; lineId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useFormAction(returnAction, null);
  if (!open)
    return (
      <button className="text-xs text-muted-foreground underline" onClick={() => setOpen(true)}>
        return
      </button>
    );
  return (
    <form onSubmit={action} className="flex flex-col gap-1">
      <Hidden {...ids} />
      <input type="hidden" name="lineId" value={lineId} />
      <div className="flex gap-1">
        <Input name="qty" placeholder="Qty" inputMode="decimal" className="h-7 w-16 text-xs" required />
        <Input name="reason" placeholder="Why" className="h-7 w-36 text-xs" required />
        <Button size="sm" variant="outline" className="h-7" disabled={pending}>
          Return
        </Button>
      </div>
      <Problems state={state} />
    </form>
  );
}

export function CancelOrder({ ids, draft }: { ids: Ids; draft: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useFormAction(cancelOrderAction, null);
  if (!open)
    return (
      <button className="self-start text-xs text-muted-foreground underline" onClick={() => setOpen(true)}>
        {draft ? "Discard draft" : "Cancel order"}
      </button>
    );
  return (
    <form onSubmit={action} className="flex flex-col gap-1">
      <Hidden {...ids} />
      <div className="flex gap-2">
        {!draft && <Input name="reason" placeholder="Why? (and call the branch)" className="w-72" required />}
        <Button size="sm" variant="destructive" disabled={pending}>
          {draft ? "Discard" : "Cancel order"}
        </Button>
      </div>
      <Problems state={state} />
    </form>
  );
}
