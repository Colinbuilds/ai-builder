// Supplier bill status labels and badge colors.
export const STATUS: Record<string, [string, "green" | "red" | "amber" | "outline" | "blue"]> = {
  NEEDS_LOOK: ["needs a look", "amber"],
  READY: ["ready to approve", "blue"],
  APPROVED: ["approved, unpaid", "outline"],
  PAID: ["paid", "green"],
  DISPUTED: ["disputed", "red"],
  VOID: ["void", "outline"],
};
