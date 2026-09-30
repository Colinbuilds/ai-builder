import { Badge } from "@/components/ui/badge";
import { formatUsd } from "@/lib/utils";

// CALL items have no price on the sheet — never show a number (CLAUDE.md §5).
export function UnitPriceCell({
  unitPrice,
  priceStatus,
}: {
  unitPrice: number | null;
  priceStatus: string;
}) {
  if (priceStatus === "CALL" || unitPrice == null)
    return <Badge variant="red">CALL — get quote</Badge>;
  return <span className="tabular-nums">{formatUsd(unitPrice)}</span>;
}
