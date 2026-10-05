"use client";
// Product / assistant / company names for client components. The root layout provides the deployment's
// profile; without a provider (tests, isolated renders) it is BTR's.
import { createContext, useContext } from "react";
import { setBrowserBrand } from "@/lib/brand-names";

export type Brand = { productName: string; assistantName: string; companyName: string; shortName: string; address: string };
const BrandContext = createContext<Brand>({ productName: "BTRpro", assistantName: "BTRbot", companyName: "BTR Contracting", shortName: "BTR", address: "10852 Hanover St., Omaha, NE 68142" });

export function BrandProvider({ brand, children }: { brand: Brand; children: React.ReactNode }) {
  // shared pure modules (readiness labels, takeoff checks) read names outside React
  setBrowserBrand(brand);
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}
export const useBrand = () => useContext(BrandContext);
