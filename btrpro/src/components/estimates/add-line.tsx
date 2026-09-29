"use client";

import { useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import { addLineAction } from "@/app/projects/estimate-actions";
import { ItemPicker } from "./item-picker";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";

export function AddLine({ estimateId, defaultSection }: { estimateId: string; defaultSection: string }) {
  const [state, action, pending] = useFormAction(addLineAction, null, { resetOnOk: true });
  const [section, setSection] = useState(defaultSection);
  const [item, setItem] = useState<{ itemNumber: string | null; description?: string | null; uom?: string }>({ itemNumber: null });
  const gc = section === "GENERAL_CONDITIONS";
  return (
    <form onSubmit={action} className="flex flex-col gap-2 rounded-md border p-3">
      <input type="hidden" name="estimateId" value={estimateId} />
      <input type="hidden" name="itemNumber" value={gc ? "" : (item.itemNumber ?? "")} />
      <div className="flex flex-wrap items-center gap-2">
        <Select name="section" value={section} onChange={(e) => setSection(e.target.value)} className="h-8">
          <option value="MATERIAL_ROOFING">Roofing material</option>
          <option value="MATERIAL_DECK">Deck material</option>
          <option value="MATERIAL_SIDING">Siding material</option>
          <option value="GENERAL_CONDITIONS">General conditions (dumpster, crane, lift, mobilization…)</option>
        </Select>
        {!gc && (
          <div className="min-w-80 flex-1">
            <ItemPicker value={item} label="From the price sheets" onPick={(it) => setItem(it ? { itemNumber: it.itemNumber, description: it.description, uom: it.uom } : { itemNumber: null })} />
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input name="itemName" placeholder={gc ? "Dumpster 30 yd, crane day, lift rental…" : "Name (if not on a sheet)"} className="h-8 min-w-60 flex-1" />
        <Input name="quantity" placeholder="Qty" inputMode="decimal" className="h-8 w-20" />
        <Input name="unit" placeholder={item.uom ?? "Unit"} className="h-8 w-20" />
        {(gc || !item.itemNumber) && (
          <>
            <Input name="unitCost" placeholder="Unit cost $" inputMode="decimal" className="h-8 w-28" />
            <Input name="source" placeholder="Priced from (quote, vendor, job)" className="h-8 w-64" />
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" name="placeholder" /> placeholder (NOT FOR FINAL BID)
            </label>
          </>
        )}
        <Button size="sm" variant="outline" disabled={pending}>
          Add line
        </Button>
      </div>
      <Problems state={state} />
    </form>
  );
}
