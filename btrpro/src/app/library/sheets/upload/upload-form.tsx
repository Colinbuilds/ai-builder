"use client";

import { useActionState, useState } from "react";
import { uploadSheet } from "../actions";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

export function UploadForm({ sheets }: { sheets: { code: string; name: string; isLoaded: boolean }[] }) {
  const [error, action, pending] = useActionState(uploadSheet, null);
  const [code, setCode] = useState(sheets[0]?.code ?? "__new");
  return (
    <form action={action} className="flex flex-col gap-3">
      <Label htmlFor="code">Which sheet is this?</Label>
      <Select id="code" name="code" value={code} onChange={(e) => setCode(e.target.value)}>
        {sheets.map((s) => (
          <option key={s.code} value={s.code}>
            {s.code} — {s.name}
            {s.isLoaded ? "" : " (not loaded yet)"}
          </option>
        ))}
        <option value="__new">New sheet…</option>
      </Select>
      {code === "__new" && (
        <div className="grid grid-cols-[6rem_1fr] gap-2">
          <Input name="newCode" placeholder="Code" maxLength={4} required />
          <Input name="newName" placeholder="Name, e.g. BTR - LP SmartSide" required />
          <Input name="newScope" placeholder="What it covers" className="col-span-2" />
        </div>
      )}
      <Label htmlFor="file">File</Label>
      <Input id="file" name="file" type="file" accept=".pdf,.txt,.csv,.zip" required className="h-auto py-2" />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button disabled={pending}>{pending ? "Reading file…" : "Upload and review"}</Button>
    </form>
  );
}
