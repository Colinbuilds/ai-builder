import { LOST_COLOR, milestoneOf } from "@/lib/projects/milestones";
import type { Stage } from "@/lib/projects/workflow";

/** The colored milestone circle (L, P, A, C, I, ✓) for a job stage. */
export function MilestoneDot({ stage, size = 20, className = "" }: { stage: string | null; size?: number; className?: string }) {
  const m = stage ? milestoneOf(stage as Stage) : null;
  const lost = stage === "LOST";
  if (!m && !lost) return null;
  return (
    <span
      title={lost ? "Lost" : m!.label}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55), background: lost ? LOST_COLOR : m!.color }}
    >
      {lost ? "✕" : m!.letter}
    </span>
  );
}
