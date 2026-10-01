import * as React from "react";
import { cn } from "@/lib/utils";

export function Table({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="relative w-full overflow-x-auto rounded-md border">
      <table
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
}
export const THead = ({
  className,
  ...p
}: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <thead className={cn("bg-muted/60 [&_tr]:border-b", className)} {...p} />
);
export const TBody = ({
  className,
  ...p
}: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <tbody className={cn("[&_tr:last-child]:border-0", className)} {...p} />
);
export const TR = ({
  className,
  ...p
}: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn("border-b hover:bg-muted/40", className)} {...p} />
);
export const TH = ({
  className,
  ...p
}: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    className={cn(
      "h-9 px-3 text-left align-middle font-medium text-muted-foreground",
      className,
    )}
    {...p}
  />
);
export const TD = ({
  className,
  ...p
}: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("px-3 py-2 align-middle", className)} {...p} />
);
