"use client";

import { useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import { addLaborAction } from "@/app/projects/estimate-actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";

export function AddLabor({
  estimateId,
  standards,
  quantities,
}: {
  estimateId: string;
  standards: { id: string; label: string }[];
  quantities: { label: string; value: number; unit: string; source: string }[];
}) {
  const [state, action, pending] = useFormAction(addLaborAction, null, { resetOnOk: true });
  const [std, setStd] = useState("");
  const [q, setQ] = useState<{ value: string; unit: string; source: string }>({ value: "", unit: "", source: "" });
  return (
    <form onSubmit={action} className="flex flex-col gap-2 rounded-md border p-3 text-sm">
      <input type="hidden" name="estimateId" value={estimateId} />
      <div className="flex flex-wrap items-center gap-2">
        <Input name="task" placeholder="Task (tear-off & install, flashing, siding install…)" className="h-8 min-w-72 flex-1" required />
        <Select
          className="h-8"
          defaultValue=""
          onChange={(e) => {
            const x = quantities.find((v) => v.label === e.target.value);
            if (x) setQ({ value: String(x.value), unit: x.unit, source: x.source });
          }}
        >
          <option value="">Quantity from…</option>
          {quantities.map((x) => (
            <option key={x.label} value={x.label}>
              {x.label}: {x.value} {x.unit}
            </option>
          ))}
        </Select>
        <Input name="quantity" value={q.value} onChange={(e) => setQ({ ...q, value: e.target.value })} placeholder="Qty" className="h-8 w-20" />
        <Input name="quantityUnit" value={q.unit} onChange={(e) => setQ({ ...q, unit: e.target.value })} placeholder="Unit" className="h-8 w-16" />
        <input type="hidden" name="quantitySource" value={q.source || "entered"} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select name="standardId" value={std} onChange={(e) => setStd(e.target.value)} className="h-8">
          <option value="">No company standard — enter rates</option>
          {standards.map((s) => (
            <option key={s.id} value={s.id}>
              Standard: {s.label}
            </option>
          ))}
        </Select>
        {!std && (
          <>
            <Input name="crewSize" placeholder="Crew" className="h-8 w-16" />
            <Input name="productionRate" placeholder="Units / labor-hr" className="h-8 w-32" />
            <Input name="hourlyRate" placeholder="$ / hr" className="h-8 w-20" />
            <Input name="burdenPct" placeholder="Burden %" className="h-8 w-24" />
            <Input name="rateSource" placeholder="Rate source (historical job, crew agreement)" className="h-8 w-72" />
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" name="placeholder" /> approved placeholder
            </label>
          </>
        )}
        <Button size="sm" variant="outline" disabled={pending}>
          Add labor
        </Button>
      </div>
      <Problems state={state} />
    </form>
  );
}
