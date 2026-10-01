"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import { planReviewAction } from "@/app/projects/docs-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PlanReviewButton({
  id,
  projectId,
  pages,
  disabled,
}: {
  id: string;
  projectId: string;
  pages: number | null;
  disabled?: boolean;
}) {
  const [state, action, pending] = useFormAction(planReviewAction, null);
  const [pick, setPick] = useState(false);
  return (
    <form onSubmit={action} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending || disabled}>
          {pending
            ? "Reading the plans… (a few minutes on big sets)"
            : "Review plans & specs"}
        </Button>
        {!pick ? (
          <button
            type="button"
            className="text-xs underline"
            onClick={() => setPick(true)}
          >
            only certain pages
          </button>
        ) : (
          <Input
            name="pages"
            placeholder={`e.g. 1-2, 8, 14-19${pages ? ` (of ${pages})` : ""}`}
            className="h-8 w-56"
          />
        )}
      </div>
      {state?.ok && (
        <p className="text-xs text-green-700 dark:text-green-400">
          {state.note}{" "}
          {state.reviewId && (
            <Link
              className="underline"
              href={`/projects/${projectId}/plans/${state.reviewId}`}
            >
              Open the brief →
            </Link>
          )}
        </p>
      )}
      {state?.problems.map((p) => (
        <span key={p} className="text-xs text-destructive">
          {p}
        </span>
      ))}
    </form>
  );
}
