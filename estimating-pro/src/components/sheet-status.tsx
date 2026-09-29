import { Badge } from "@/components/ui/badge";
import { dateStatusVariant, describeDateStatus, sheetDateStatus, type SheetDates } from "@/lib/sheets/date-status";

export function SheetStatusBadge({ sheet, withText = false }: { sheet: SheetDates; withText?: boolean }) {
  const s = sheetDateStatus(sheet);
  return (
    <span className="inline-flex flex-col gap-1">
      <Badge variant={dateStatusVariant(s.status)} title={describeDateStatus(s)}>
        {s.status}
      </Badge>
      {withText && <span className="text-xs text-muted-foreground">{describeDateStatus(s)}</span>}
    </span>
  );
}
