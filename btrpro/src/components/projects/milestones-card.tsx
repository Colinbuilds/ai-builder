"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useFormAction } from "@/components/use-form-action";
import { changeStageAction } from "@/app/projects/actions";
import { MILESTONES, milestoneIndex, nextStage, LOST_COLOR } from "@/lib/projects/milestones";
import { STAGE_LABEL, type Stage } from "@/lib/projects/workflow";
import { Problems } from "./problems";
import { StageControl } from "./stage-control";

/** Lead → Prospect → Approved → Completed → Invoiced → Closed, with Advance Job to the next stage. */
export function MilestonesCard({
  id,
  stage,
  reached,
  inFor,
  canEdit,
}: {
  id: string;
  stage: Stage;
  reached: Record<string, string>; // milestone key → date reached
  inFor: string;
  canEdit: boolean;
}) {
  const [state, action, pending] = useFormAction(changeStageAction, null);
  const [more, setMore] = useState(false);
  const next = nextStage(stage);
  const at = milestoneIndex(stage);
  const lost = stage === "LOST";
  return (
    <section className="border-t-2 border-t-[#3b7bc8] bg-background shadow-sm">
      <div className="flex min-h-10 items-center justify-between gap-2 bg-[#f4f5f7] pl-3 dark:bg-muted">
        <h2 className="text-[17px] font-light">Milestones</h2>
        <div className="flex items-stretch gap-3 self-stretch text-xs">
          <span className="self-center text-muted-foreground">
            In {lost ? "Lost" : MILESTONES[at]?.label} milestone: <span className="font-semibold text-foreground">{inFor}</span>
          </span>
          {canEdit && (
            <button type="button" onClick={() => setMore(!more)} aria-expanded={more} aria-label="More stage options" className={`px-3 ${more ? "bg-[#2c62a3]" : "bg-[#3b7bc8]"} text-white`}>
              <MoreHorizontal size={18} />
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center">
        <div className="flex min-w-48 flex-col gap-3">
          {lost ? (
            <span className="text-sm font-medium" style={{ color: LOST_COLOR }}>
              Lost job. Use ••• to reopen it.
            </span>
          ) : next ? (
            <span className="text-sm">
              <span className="text-[#f58220]">NEXT STEP:</span> {STAGE_LABEL[next]}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">Job closed.</span>
          )}
          {canEdit && next && (
            <form onSubmit={action} className="flex flex-col gap-2">
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="to" value={next} />
              {state?.overridable && (
                <>
                  <input name="reason" placeholder="Reason for submitting anyway" className="rounded border px-2 py-1 text-sm" required />
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" name="override" /> Submit as NOT READY FOR HARD BID
                  </label>
                </>
              )}
              <button disabled={pending} className="self-start rounded-sm bg-[#78b833] px-4 py-2 text-sm text-white shadow hover:bg-[#6aa32a] disabled:opacity-60">
                {pending ? "Advancing…" : "Advance job"}
              </button>
            </form>
          )}
        </div>
        <ol className="flex flex-1 items-start justify-between overflow-x-auto">
          {MILESTONES.map((m, i) => {
            const done = !lost && i <= at;
            return (
              <li key={m.key} className={i === 0 ? "flex items-start" : "flex flex-1 items-start"}>
                {i > 0 && <span className={`mt-5 h-0.5 flex-1 ${done ? "bg-[#9aa3ad]" : "bg-[#d5d9de]"}`} />}
                <span className="flex w-14 shrink-0 flex-col items-center gap-1 text-center text-[11px] sm:w-20 sm:text-xs">
                  <span
                    className="flex size-9 items-center justify-center rounded-full text-base font-bold text-white sm:size-10 sm:text-lg"
                    style={{ background: done ? m.color : "#c4c9cf", boxShadow: i === at ? `0 0 0 3px ${m.color}40` : undefined }}
                  >
                    {m.letter}
                  </span>
                  <span>{m.label}</span>
                  <span className="text-[10px] text-muted-foreground">{reached[m.key] ?? "--"}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <Problems state={state} className="mx-4 mb-4" />
      {more && canEdit && (
        <div className="border-t p-4">
          <p className="mb-2 text-xs text-muted-foreground">
            Now: <span className="font-medium text-foreground">{STAGE_LABEL[stage]}</span>. Move to any stage, back a step (needs a reason), or mark it Lost.
          </p>
          <StageControl key={stage} id={id} current={stage} />
        </div>
      )}
    </section>
  );
}
