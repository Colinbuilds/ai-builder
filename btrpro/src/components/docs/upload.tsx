"use client";

import { useRef, useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import {
  importDriveAction,
  uploadDocumentsAction,
} from "@/app/projects/docs-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";

export function UploadDocs({ projectId }: { projectId: string }) {
  const [state, action, pending] = useFormAction(uploadDocumentsAction, null);
  const [over, setOver] = useState(false);
  const [names, setNames] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  return (
    <form onSubmit={action} className="flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (input.current && e.dataTransfer.files.length) {
            input.current.files = e.dataTransfer.files;
            setNames([...e.dataTransfer.files].map((f) => f.name));
          }
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed p-6 text-sm ${over ? "border-primary bg-accent" : ""}`}
      >
        <span className="font-medium">
          Drop EagleView reports, plans, specs, photos, sub proposals…
        </span>
        <span className="text-muted-foreground">
          or click to choose files (50 MB each)
        </span>
        <input
          ref={input}
          type="file"
          name="files"
          multiple
          className="sr-only"
          onChange={(e) =>
            setNames([...(e.target.files ?? [])].map((f) => f.name))
          }
        />
        {names.length > 0 && (
          <span className="mt-2 text-xs">{names.join(", ")}</span>
        )}
      </label>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending || !names.length}>
          {pending ? "Uploading…" : "Upload"}
        </Button>
        {state?.note && (
          <span className="text-sm text-muted-foreground">{state.note}</span>
        )}
      </div>
      <Problems state={state} />
    </form>
  );
}

export function DriveImport({ projectId }: { projectId: string }) {
  const [state, action, pending] = useFormAction(importDriveAction, null);
  return (
    <form onSubmit={action} className="flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="flex gap-2">
        <Input
          name="link"
          placeholder="Google Drive file or folder link"
          className="flex-1"
          required
        />
        <Button size="sm" variant="outline" disabled={pending}>
          {pending ? "Importing…" : "Import"}
        </Button>
      </div>
      {state?.note && (
        <span className="text-sm text-muted-foreground">{state.note}</span>
      )}
      <Problems state={state} />
    </form>
  );
}
