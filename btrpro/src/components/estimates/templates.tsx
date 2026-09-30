"use client";

import { useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import {
  applyTemplateAction,
  createEstimateAction,
  saveAsTemplateAction,
  updateTemplateMetaAction,
} from "@/app/projects/estimate-actions";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";

export type TemplateOpt = {
  id: string;
  name: string;
  category: string;
  group: string;
  module: string;
  impactClass: string | null;
};
const CAT: Record<string, string> = {
  SHINGLE: "Shingles",
  FLAT: "Flat roof",
  SIDING: "Siding",
  DECK: "Deck",
  OTHER: "Other",
};

/** Grouped template picker: "Shingles · Class 4 / impact-resistant", "Siding · Vinyl"… */
export function TemplateSelect({
  templates,
  name = "templateId",
  value,
  onChange,
  blank,
}: {
  templates: TemplateOpt[];
  name?: string;
  value?: string;
  onChange?: (v: string) => void;
  blank: string;
}) {
  const groups = new Map<string, TemplateOpt[]>();
  for (const t of templates) {
    const k = `${CAT[t.category] ?? t.category} · ${t.group}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return (
    <Select
      name={name}
      value={value}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      defaultValue={onChange ? undefined : ""}
      className="h-8 max-w-md"
    >
      <option value="">{blank}</option>
      {[...groups.entries()].map(([g, ts]) => (
        <optgroup key={g} label={g}>
          {ts.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.impactClass === "CLASS_4"
                ? " (Class 4)"
                : t.impactClass === "CLASS_3"
                  ? " (Class 3)"
                  : ""}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

/** One-click "start an estimate on this job with this template" (plan review suggestions). */
export function StartFromTemplate({
  projectId,
  templateId,
  label,
}: {
  projectId: string;
  templateId: string;
  label?: string;
}) {
  const [state, action, pending] = useFormAction(createEstimateAction, null);
  return (
    <form onSubmit={action} className="inline-flex flex-col gap-1">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="scopeType" value="STEEP" />
      <Button size="sm" variant="outline" disabled={pending}>
        {pending ? "Starting…" : (label ?? "Start estimate from this template")}
      </Button>
      <Problems state={state} />
    </form>
  );
}

/** Templates page: pick a job, start an estimate there with this template. */
export function UseOnJob({
  templateId,
  jobs,
}: {
  templateId: string;
  jobs: { id: string; name: string }[];
}) {
  const [state, action, pending] = useFormAction(createEstimateAction, null);
  const [open, setOpen] = useState(false);
  if (!jobs.length) return null;
  if (!open)
    return (
      <button
        type="button"
        className="self-start text-xs underline"
        onClick={() => setOpen(true)}
      >
        Use on a job
      </button>
    );
  return (
    <form onSubmit={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="scopeType" value="STEEP" />
      <Select
        name="projectId"
        className="h-8 max-w-xs"
        required
        defaultValue=""
      >
        <option value="" disabled>
          Pick a job…
        </option>
        {jobs.map((j) => (
          <option key={j.id} value={j.id}>
            {j.name}
          </option>
        ))}
      </Select>
      <Button size="sm" variant="outline" disabled={pending}>
        {pending ? "Starting…" : "Start estimate"}
      </Button>
      <Problems state={state} className="w-full" />
    </form>
  );
}

export function ApplyTemplate({
  estimateId,
  templates,
}: {
  estimateId: string;
  templates: TemplateOpt[];
}) {
  const [state, action, pending] = useFormAction(applyTemplateAction, null);
  const [id, setId] = useState("");
  if (!templates.length) return null;
  return (
    <form onSubmit={action} className="flex flex-col gap-1">
      <input type="hidden" name="estimateId" value={estimateId} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Product system</span>
        <TemplateSelect
          templates={templates}
          value={id}
          onChange={setId}
          blank="Apply a template…"
        />
        <Button size="sm" variant="outline" disabled={pending || !id}>
          Apply
        </Button>
      </div>
      {state?.ok && (
        <p className="text-sm text-green-700 dark:text-green-400">
          {state.note}
        </p>
      )}
      <Problems state={state} />
    </form>
  );
}

export function SaveAsTemplate({
  estimateId,
  modules,
  templates,
  isAdmin,
}: {
  estimateId: string;
  modules: string[];
  templates: TemplateOpt[];
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useFormAction(saveAsTemplateAction, null);
  const [module, setModule] = useState(modules[0] ?? "steep");
  const [klass, setKlass] = useState("");
  if (!open)
    return (
      <button
        className="self-start text-xs underline"
        onClick={() => setOpen(true)}
      >
        Save these product picks as a template
      </button>
    );
  const cat =
    module === "steep"
      ? "SHINGLE"
      : module === "lowSlope"
        ? "FLAT"
        : module === "siding"
          ? "SIDING"
          : "DECK";
  return (
    <form
      onSubmit={action}
      className="flex flex-col gap-2 rounded-md border p-3"
    >
      <input type="hidden" name="estimateId" value={estimateId} />
      <input type="hidden" name="category" value={cat} />
      <div className="grid gap-2 sm:grid-cols-4">
        <Select
          name="module"
          value={module}
          onChange={(e) => setModule(e.target.value)}
        >
          {modules.map((m) => (
            <option key={m} value={m}>
              {m === "steep"
                ? "Steep-slope takeoff"
                : m === "lowSlope"
                  ? "Low-slope takeoff"
                  : m === "siding"
                    ? "Siding takeoff"
                    : "Deck takeoff"}
            </option>
          ))}
        </Select>
        <Input
          name="name"
          placeholder="Template name, e.g. GAF HDZ Charcoal"
          required
        />
        <Input
          name="group"
          placeholder="Group: Class 4, Class 3, EPDM, Vinyl…"
          required
        />
        <Input name="brand" placeholder="Brand" />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Select
          name="impactClass"
          value={klass}
          onChange={(e) => setKlass(e.target.value)}
        >
          <option value="">Impact class: not stated</option>
          <option value="CLASS_4">Class 4</option>
          <option value="CLASS_3">Class 3</option>
        </Select>
        {klass && (
          <Input
            name="impactSource"
            placeholder="Source (spec sheet / UL 2218 listing)"
            required
          />
        )}
        <Input name="notes" placeholder="Notes for estimators" />
      </div>
      {isAdmin && (
        <Select name="replaceId" defaultValue="">
          <option value="">Save as a new template</option>
          {templates
            .filter((t) => t.module === module)
            .map((t) => (
              <option key={t.id} value={t.id}>
                Replace the picks in: {t.name}
              </option>
            ))}
        </Select>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending}>
          Save template
        </Button>
        {state?.ok && (
          <span className="text-sm text-green-700 dark:text-green-400">
            {state.note}
          </span>
        )}
      </div>
      <Problems state={state} />
    </form>
  );
}

export function TemplateMetaForm({
  t,
}: {
  t: {
    id: string;
    name: string;
    group: string;
    impactClass: string | null;
    impactSource: string | null;
    notes: string | null;
    active: boolean;
  };
}) {
  const [state, action, pending] = useFormAction(
    updateTemplateMetaAction,
    null,
  );
  const [klass, setKlass] = useState(t.impactClass ?? "");
  return (
    <form onSubmit={action} className="flex flex-col gap-2 border-t pt-2">
      <input type="hidden" name="id" value={t.id} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label>Name</Label>
          <Input name="name" defaultValue={t.name} className="h-8" />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Group</Label>
          <Input name="group" defaultValue={t.group} className="h-8" />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Impact class</Label>
          <Select
            name="impactClass"
            value={klass}
            onChange={(e) => setKlass(e.target.value)}
            className="h-8"
          >
            <option value="">Not stated</option>
            <option value="CLASS_4">Class 4</option>
            <option value="CLASS_3">Class 3</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Source of the rating</Label>
          <Input
            name="impactSource"
            defaultValue={t.impactSource ?? ""}
            className="h-8"
            required={!!klass}
            placeholder="spec sheet / UL 2218 listing"
          />
        </div>
      </div>
      <Input
        name="notes"
        defaultValue={t.notes ?? ""}
        className="h-8"
        placeholder="Notes"
      />
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" name="active" defaultChecked={t.active} />{" "}
          Active
        </label>
        <Button size="sm" variant="outline" disabled={pending}>
          Save
        </Button>
        {state?.ok && <span className="text-sm text-green-700">Saved.</span>}
      </div>
      <Problems state={state} />
    </form>
  );
}
