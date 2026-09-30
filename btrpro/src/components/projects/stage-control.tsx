"use client";

import { useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import { changeStageAction } from "@/app/projects/actions";
import { STAGES, STAGE_LABEL, type Stage } from "@/lib/projects/workflow";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Problems } from "./problems";

export function StageControl({ id, current }: { id: string; current: Stage }) {
  const [state, action, pending] = useFormAction(changeStageAction, null);
  const [to, setTo] = useState<Stage>(
    STAGES[Math.min(STAGES.indexOf(current) + 1, STAGES.length - 2)],
  );
  return (
    <form onSubmit={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Move to</span>
        <Select
          name="to"
          value={to}
          onChange={(e) => setTo(e.target.value as Stage)}
        >
          {STAGES.filter((s) => s !== current).map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </Select>
        <Input
          name="reason"
          placeholder={
            to === "LOST"
              ? "Why was it lost?"
              : "Reason (needed to go back or override)"
          }
          className="w-72"
        />
        <Button size="sm" disabled={pending}>
          {pending ? "Moving…" : "Move"}
        </Button>
      </div>
      {state?.overridable && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="override" /> Submit anyway as NOT READY
          FOR HARD BID (the reason is logged)
        </label>
      )}
      <Problems state={state} />
    </form>
  );
}
