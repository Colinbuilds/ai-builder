"use client";

import { useFormAction } from "@/components/use-form-action";
import { catchUpAction } from "@/app/projects/comms-actions";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Problems } from "@/components/projects/problems";
import { useBrand } from "@/components/brand";

export function CatchUp({
  projectId,
  latest,
  aiReady,
}: {
  projectId: string;
  latest: {
    content: string;
    createdAt: string;
    coversFrom: string | null;
    by: string | null;
  } | null;
  aiReady: boolean;
}) {
  const { assistantName: bot } = useBrand();
  const [state, action, pending] = useFormAction(catchUpAction, null);
  return (
    <section className="rounded-md border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Catch me up</h2>
        <form onSubmit={action} className="flex gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          <Button
            size="sm"
            name="mode"
            value="since_last"
            disabled={pending || !aiReady}
          >
            {pending ? "Reading the job…" : "Since I last looked"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            name="mode"
            value="all"
            disabled={pending || !aiReady}
          >
            Whole job
          </Button>
        </form>
      </div>
      {!aiReady && (
        <p className="mt-2 text-sm text-muted-foreground">
          AI isn&apos;t configured on this server (ANTHROPIC_API_KEY).
        </p>
      )}
      <Problems state={state} className="mt-2" />
      {latest && (
        <div className="mt-3">
          <p className="mb-2 text-xs text-muted-foreground">
            {latest.coversFrom
              ? `Covers since ${latest.coversFrom}`
              : "Covers the whole job"}{" "}
            · written {latest.createdAt}
            {latest.by && ` for ${latest.by}`}. {bot} summary of the job record;
            check anything you act on.
          </p>
          <Markdown text={latest.content} />
        </div>
      )}
    </section>
  );
}
