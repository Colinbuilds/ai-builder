// Who can do what. Shared by server and client code.
import type { Role } from "./session";

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  ESTIMATOR: "Sales / Estimator",
  OFFICE: "Office",
  PURCHASING: "Purchasing",
  VIEWER: "Viewer",
};
export const ROLES = Object.keys(ROLE_LABEL) as Role[];

/** Estimates, proposals, job details, production. */
export const EDIT_ROLES = ["ADMIN", "ESTIMATOR"] as const satisfies readonly Role[];
/** Customer invoices, payments, crew pay, receivables. */
export const BILLING_ROLES = ["ADMIN", "ESTIMATOR", "OFFICE"] as const satisfies readonly Role[];
/** Material orders, deliveries, price sheets. */
export const PURCHASING_ROLES = ["ADMIN", "ESTIMATOR", "PURCHASING"] as const satisfies readonly Role[];
/** Supplier receipts and bills, job costs, customers, tasks, job chat — everyone on staff. */
export const STAFF_ROLES = ["ADMIN", "ESTIMATOR", "OFFICE", "PURCHASING"] as const satisfies readonly Role[];
