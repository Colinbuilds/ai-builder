"use client";

import { useActionState } from "react";
import { saveCoverage } from "@/app/library/sheets/actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

export function CoverageForm({ id, qty, unit }: { id: string; qty: number | null; unit: string }) {
  const [error, action, pending] = useActionState(saveCoverage, null);
  return (
    <form action={action} className="mt-3 flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input name="qty" type="number" step="any" min="0" defaultValue={qty ?? ""} placeholder="Qty" className="w-24" />
      <Input name="unit" defaultValue={unit} placeholder="SF/RL" className="w-24 uppercase" />
      <Select name="source" defaultValue="MANUFACTURER_DOC">
        <option value="MANUFACTURER_DOC">From manufacturer data</option>
        <option value="USER_ENTERED">Entered by me</option>
      </Select>
      <Button size="sm" disabled={pending}>
        Save coverage
      </Button>
      <Button size="sm" variant="ghost" name="clear" value="1" disabled={pending}>
        Clear
      </Button>
      {error && <p className="w-full text-sm text-destructive">{error}</p>}
    </form>
  );
}
