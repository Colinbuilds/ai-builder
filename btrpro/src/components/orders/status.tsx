import { Badge } from "@/components/ui/badge";

const V: Record<
  string,
  "default" | "blue" | "green" | "amber" | "red" | "outline"
> = {
  DRAFT: "outline",
  SENT: "blue",
  CONFIRMED: "blue",
  PARTIAL: "amber",
  DELIVERED: "green",
  CANCELLED: "default",
};
export function OrderStatusBadge({ status }: { status: string }) {
  return <Badge variant={V[status] ?? "default"}>{status.toLowerCase()}</Badge>;
}
