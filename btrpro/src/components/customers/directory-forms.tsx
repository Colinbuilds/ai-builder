"use client";

import { useActionState, useState } from "react";
import { importDirectoryAction, rereadDirectoryAction, uploadDirectoryAction } from "@/app/customers/directory/actions";
import { Problems } from "@/components/projects/problems";
import { Button } from "@/components/ui/button";

export function DirectoryUpload({ companyId, compact }: { companyId?: string; compact?: boolean }) {
  const [state, dispatch, pending] = useActionState(uploadDirectoryAction, null);
  const [name, setName] = useState("");
  return (
    <form action={dispatch} className={compact ? "flex flex-wrap items-center gap-2 text-sm" : "flex flex-col gap-2 rounded-lg border border-btr-line p-4 text-sm"}>
      {companyId && <input type="hidden" name="companyId" value={companyId} />}
      <label className="cursor-pointer text-btr-link hover:underline">
        <input name="file" type="file" accept="application/pdf,.docx,image/*" className="sr-only" onChange={(e) => setName(e.currentTarget.files?.[0]?.name ?? "")} />
        {name || "Import staff directory (PDF, Word or photo)…"}
      </label>
      {name && (
        <Button size="sm" disabled={pending}>
          {pending ? "Uploading…" : "Read directory"}
        </Button>
      )}
      <Problems state={state} />
    </form>
  );
}

export function ImportDirectoryForm({ id, companies, defaultCompanyId, suggestedName }: { id: string; companies: { id: string; name: string }[]; defaultCompanyId: string | null; suggestedName: string }) {
  const [state, dispatch, pending] = useActionState(importDirectoryAction, null);
  const [target, setTarget] = useState(defaultCompanyId ?? "new");
  return (
    <form action={dispatch} className="flex flex-col gap-2 rounded-lg border border-btr-line p-4 text-sm">
      <input type="hidden" name="id" value={id} />
      <label className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Import into</span>
        <select name="companyId" value={target} onChange={(e) => setTarget(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2">
          <option value="new">New company…</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {target === "new" && (
        <div className="flex flex-wrap gap-2">
          <input name="companyName" defaultValue={suggestedName} placeholder="Company name" className="h-9 min-w-60 rounded-md border border-input bg-background px-2" />
          <select name="companyType" defaultValue="PROPERTY_MANAGER" className="h-9 rounded-md border border-input bg-background px-2">
            {["PROPERTY_MANAGER", "OWNER", "GC", "BUILDER", "PUBLIC_AGENCY", "ARCHITECT", "SUBCONTRACTOR", "SUPPLIER"].map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </select>
        </div>
      )}
      <p className="text-xs text-muted-foreground">People already on the account are updated (matched by email or name). Nobody is deleted.</p>
      <Button disabled={pending} className="self-start">
        {pending ? "Importing…" : "Import"}
      </Button>
      <Problems state={state} />
    </form>
  );
}

export function RereadButton({ id }: { id: string }) {
  const [state, dispatch, pending] = useActionState(rereadDirectoryAction, null);
  return (
    <form action={dispatch}>
      <input type="hidden" name="id" value={id} />
      <Button size="sm" variant="outline" disabled={pending}>
        Read again
      </Button>
      <Problems state={state} />
    </form>
  );
}
