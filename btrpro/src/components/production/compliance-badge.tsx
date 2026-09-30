import { Badge } from "@/components/ui/badge";
import type { Compliance } from "@/lib/production/rules";

export function ComplianceBadge({ c }: { c: Compliance }) {
  if (!c.items.length) return <span className="text-xs text-muted-foreground">covered by BTR</span>;
  const v = c.status === "OK" ? "green" : c.status === "EXPIRING" ? "amber" : "red";
  const text = c.status === "OK" ? "insured" : c.status === "EXPIRING" ? "expiring soon" : c.status === "MISSING" ? "insurance missing" : "insurance expired";
  return (
    <span className="flex flex-col gap-0.5">
      <Badge variant={v}>{text}</Badge>
      {c.items
        .filter((i) => i.status !== "OK")
        .map((i) => (
          <span key={i.label} className="text-xs text-muted-foreground">
            {i.label}: {i.date ? i.date.toISOString().slice(0, 10) : "not on file"}
          </span>
        ))}
    </span>
  );
}

export const crewWarning = (c: Compliance) => (c.status === "EXPIRED" ? "insurance expired" : c.status === "MISSING" ? "insurance missing" : c.status === "EXPIRING" ? "insurance expiring" : null);
