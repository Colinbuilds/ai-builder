"use client";

import { useActionState, useState } from "react";
import { uploadSheet } from "@/app/library/sheets/actions";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

export function BuilderUpload({ companyId, prefix, sheets }: { companyId: string; prefix: string; sheets: { code: string; name: string }[] }) {
  const [error, action, pending] = useActionState(uploadSheet, null);
  const [code, setCode] = useState(sheets[0]?.code ?? "__new");
  return (
    <form action={action} className="flex flex-col gap-2 rounded-md border p-3">
      <input type="hidden" name="companyId" value={companyId} />
      <Label>Upload their pricing (PDF from ABC, or CSV)</Label>
      <Select name="code" value={code} onChange={(e) => setCode(e.target.value)} className="max-w-md">
        {sheets.map((s) => (
          <option key={s.code} value={s.code}>
            New version of {s.code} — {s.name}
          </option>
        ))}
        <option value="__new">New sheet…</option>
      </Select>
      {code === "__new" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm">{prefix}-</span>
          <Input name="newCode" placeholder="SS" maxLength={6} className="w-24 uppercase" required />
          <Input name="newName" placeholder="Name, e.g. Legacy Homes - Steep Slope" className="min-w-72 flex-1" />
          <Input name="newScope" placeholder="What it covers" className="min-w-60 flex-1" />
        </div>
      )}
      <Input name="file" type="file" accept=".pdf,.txt,.csv,.zip" required className="h-auto max-w-md py-2" />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button disabled={pending} className="self-start">
        {pending ? "Reading file…" : "Upload and review"}
      </Button>
      <p className="text-xs text-muted-foreground">
        You review every row before it goes live, same as BTR sheets. A CSV needs the columns of{" "}
        <a href="/api/builders/template.csv" className="underline">
          this template
        </a>
        .
      </p>
    </form>
  );
}
