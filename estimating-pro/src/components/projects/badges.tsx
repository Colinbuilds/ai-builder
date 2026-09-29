import { Badge } from "@/components/ui/badge";
import { READINESS_LABEL, readinessVariant, type Readiness } from "@/lib/projects/readiness";
import { STAGE_LABEL, type Stage } from "@/lib/projects/workflow";

export function ReadinessBadge({ readiness }: { readiness: Readiness }) {
  return <Badge variant={readinessVariant(readiness)}>{READINESS_LABEL[readiness]}</Badge>;
}

const stageVariant = (s: Stage) =>
  s === "LOST" ? "red" : s === "CLOSED" || s === "PAID" ? "green" : ["SOLD", "SCHEDULED", "IN_PRODUCTION", "COMPLETE", "INVOICED"].includes(s) ? "blue" : "default";

export function StageBadge({ stage }: { stage: Stage }) {
  return <Badge variant={stageVariant(stage)}>{STAGE_LABEL[stage]}</Badge>;
}

export function IntakeStatusBadge({ status }: { status: string }) {
  const v = status === "VERIFIED" ? "green" : status === "ASSUMED" ? "amber" : status === "MISSING" ? "red" : "outline";
  return <Badge variant={v}>{status === "NOT_APPLICABLE" ? "N/A" : status}</Badge>;
}
