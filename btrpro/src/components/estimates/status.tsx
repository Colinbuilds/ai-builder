import { Badge } from "@/components/ui/badge";
import { botName } from "@/lib/company-profile";

const LABEL: Record<string, string> = {
  VERIFIED: "Verified",
  SHEET_STALE: "Sheet stale",
  SHEET_EXPIRED: "Sheet expired",
  CALL_FOR_PRICE: "CALL — get quote",
  MISSING_ITEM: "Missing item",
  MISSING_PRICE: "Missing price",
  PLACEHOLDER: "Placeholder",
  ASSUMPTION_APPROVED: "Approved assumption",
  PENDING_AI: `${botName()} suggestion`,
  MISSING: "Missing",
};
// green verified · amber stale/placeholder/assumption · red missing/expired/call · blue pending AI (BUILD_PROMPT §5)
const VARIANT: Record<string, "green" | "amber" | "red" | "blue"> = {
  VERIFIED: "green",
  SHEET_STALE: "amber",
  PLACEHOLDER: "amber",
  ASSUMPTION_APPROVED: "amber",
  SHEET_EXPIRED: "red",
  CALL_FOR_PRICE: "red",
  MISSING_ITEM: "red",
  MISSING_PRICE: "red",
  MISSING: "red",
  PENDING_AI: "blue",
};
export function LineStatus({ status }: { status: string }) {
  return (
    <Badge variant={VARIANT[status] ?? "outline"}>
      {LABEL[status] ?? status}
    </Badge>
  );
}
