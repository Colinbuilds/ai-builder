"use client";

import { useFormAction } from "@/components/use-form-action";
import { postUpdateAction } from "@/app/shell-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";

export function PostUpdate() {
  const [state, action, pending] = useFormAction(postUpdateAction, null, { resetOnOk: true });
  return (
    <form id="post" onSubmit={action} className="flex scroll-mt-28 flex-col gap-2 rounded-md border p-4">
      <h2 className="font-medium">Post an update</h2>
      <Input name="title" placeholder="Headline (e.g. New Malarkey pricing starts Monday)" maxLength={200} required />
      <textarea name="body" rows={4} placeholder="Details (optional). Markdown works." className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="pinned" /> Pin to the top of the dashboard
        </label>
        <Button size="sm" disabled={pending} className="ml-auto">
          {pending ? "Posting…" : "Post update"}
        </Button>
      </div>
      {state?.ok && <p className="text-sm text-green-700">Posted.</p>}
      <Problems state={state} />
    </form>
  );
}
