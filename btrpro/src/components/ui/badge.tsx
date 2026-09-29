import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Status colors follow BUILD_PROMPT §5: green verified, amber stale/placeholder, red missing/expired/call, blue pending AI.
const badgeVariants = cva("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold whitespace-nowrap", {
  variants: {
    variant: {
      default: "border-transparent bg-secondary text-secondary-foreground",
      green: "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300",
      amber: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
      red: "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
      blue: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300",
      outline: "text-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
