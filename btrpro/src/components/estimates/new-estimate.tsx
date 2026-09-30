"use client";

import { useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import { createEstimateAction } from "@/app/projects/estimate-actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";
import { TemplateSelect, type TemplateOpt } from "./templates";

/** Two ways to start: from a product-system template (products pre-picked), or blank with a scope. */
export function NewEstimate({
  projectId,
  defaultScope,
  templates = [],
  initialTemplate = "",
}: {
  projectId: string;
  defaultScope: string;
  templates?: TemplateOpt[];
  initialTemplate?: string;
}) {
  const [state, action, pending] = useFormAction(createEstimateAction, null);
  const [tpl, setTpl] = useState(
    templates.some((t) => t.id === initialTemplate) ? initialTemplate : "",
  );
  const chosen = templates.find((t) => t.id === tpl);
  return (
    <form
      onSubmit={action}
      className="flex flex-col gap-3 rounded-md border p-4"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <h2 className="font-semibold">New estimate</h2>
      {templates.length > 0 ? (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">
            1. Start from a template (recommended)
          </label>
          <TemplateSelect
            templates={templates}
            value={tpl}
            onChange={setTpl}
            blank="Pick a product system — GAF HDZ, Hardie Cedarmill, Mulehide EPDM…"
          />
          <p className="text-xs text-muted-foreground">
            {chosen
              ? `Products for ${chosen.name} are filled in for you. Quantities come from this job's confirmed measurements; prices from the current sheets (or the builder's pricing).`
              : "A template fills in the shingles, starter, ridge, underlayment, drip edge, vents… for one brand and line. Or leave it blank and pick products yourself."}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No templates loaded yet (Settings → Estimate templates).
        </p>
      )}
      {!chosen && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">
            {templates.length ? "Or start blank — scope" : "Scope"}
          </label>
          <Select
            name="scopeType"
            defaultValue={defaultScope}
            className="h-8 max-w-xs"
          >
            <option value="STEEP">Steep-slope</option>
            <option value="LOW_SLOPE">Low-slope</option>
            <option value="DECK">Roof deck</option>
            <option value="SIDING">Siding</option>
            <option value="PANELS">Metal / wall panels</option>
            <option value="MIXED">Mixed scopes</option>
          </Select>
        </div>
      )}
      <Button size="sm" className="self-start" disabled={pending}>
        {pending
          ? "Starting…"
          : chosen
            ? `Start estimate with ${chosen.name}`
            : "Start blank estimate"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Already started? Open the estimate and use “Product system → Apply” to
        add another template (e.g. siding on a roof job).
      </p>
      <Problems state={state} className="w-full" />
    </form>
  );
}
