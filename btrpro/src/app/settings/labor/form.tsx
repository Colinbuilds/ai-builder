"use client";

import { useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import { saveLaborStandardAction } from "@/app/projects/estimate-actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";
import { useBrand } from "@/components/brand";

export function LaborStandardForm() {
  const { shortName } = useBrand();
  const [state, action, pending] = useFormAction(saveLaborStandardAction, null, { resetOnOk: true });
  const [type, setType] = useState("UNIT");
  return (
    <form onSubmit={action} className="flex flex-col gap-2 rounded-md border p-4">
      <h2 className="font-semibold">Add a standard</h2>
      <div className="flex flex-wrap gap-2">
        <Select name="rateType" value={type} onChange={(e) => setType(e.target.value)} className="w-44">
          <option value="UNIT">Piece rate ($ per unit)</option>
          <option value="HOURLY">Hourly (production rate)</option>
        </Select>
        <Input name="category" placeholder="Category (Roofing, Siding, Gutters…)" className="w-56" />
        <Input name="task" placeholder="Task (e.g. Tear-off 1 layer + install architectural shingles)" className="min-w-80 flex-1" required />
        <Input name="unit" placeholder="Unit (SQ, SF, LF, EA)" className="w-32" required />
        {type === "UNIT" ? (
          <Input name="unitRate" placeholder="$ per unit" className="w-28" required />
        ) : (
          <>
            <Input name="productionRate" placeholder="Units per labor-hour" className="w-40" required />
            <Input name="crewSize" placeholder="Crew size" className="w-24" />
            <Input name="hourlyRate" placeholder="$ / hr" className="w-24" />
            <Input name="burdenPct" placeholder="Burden %" className="w-24" />
          </>
        )}
        <Input name="source" placeholder={`Source (${shortName} 2025 job average, crew agreement…)`} className="min-w-72 flex-1" required />
        <Button disabled={pending}>Save</Button>
      </div>
      {state?.ok && <span className="text-sm text-green-700 dark:text-green-400">Saved.</span>}
      <Problems state={state} />
    </form>
  );
}
