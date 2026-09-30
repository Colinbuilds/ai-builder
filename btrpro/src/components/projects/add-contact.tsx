"use client";

import { useFormAction } from "@/components/use-form-action";
import { addProjectContactAction } from "@/app/projects/actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Problems } from "./problems";

const ROLES = ["HOMEOWNER", "OWNER_REP", "GC_PM", "SUPERINTENDENT", "PROPERTY_MANAGER", "ARCHITECT", "BILLING", "OTHER"];

export function AddContact({ projectId, contacts }: { projectId: string; contacts: { id: string; label: string }[] }) {
  const [state, action, pending] = useFormAction(addProjectContactAction, null, { resetOnOk: true });
  return (
    <form onSubmit={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <Select name="contactId" defaultValue="" className="max-w-72">
        <option value="">Add a contact…</option>
        {contacts.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </Select>
      <Select name="role" defaultValue="GC_PM">
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r.replace(/_/g, " ").toLowerCase()}
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-1 text-sm">
        <input type="checkbox" name="isPrimary" /> primary
      </label>
      <Button size="sm" variant="outline" disabled={pending}>
        Add
      </Button>
      <Problems state={state} className="w-full" />
    </form>
  );
}
