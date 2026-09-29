import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const formatUsd = (n: number) => usd.format(n);

// Dates are stored as UTC midnight; format in UTC so they don't shift a day.
export const formatDate = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("en-US", { timeZone: "UTC", month: "numeric", day: "numeric", year: "numeric" }) : "—";
