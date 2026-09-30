"use client";

import { setDocTypeAction } from "@/app/projects/docs-actions";
import { Select } from "@/components/ui/input";

const TYPES: [string, string][] = [
  ["EAGLEVIEW", "EagleView report"],
  ["PLANS", "Plans"],
  ["SPECS", "Specs"],
  ["MFR_DATA", "Manufacturer data"],
  ["SUB_PROPOSAL", "Sub proposal"],
  ["CHANGE_ORDER", "Change order"],
  ["PHOTO", "Photo"],
  ["OTHER", "Other"],
];

export function DocTypeSelect({
  id,
  type,
  disabled,
}: {
  id: string;
  type: string;
  disabled?: boolean;
}) {
  return (
    <form action={setDocTypeAction}>
      <input type="hidden" name="id" value={id} />
      <Select
        name="type"
        defaultValue={type}
        disabled={disabled}
        className="h-8"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {TYPES.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
    </form>
  );
}
