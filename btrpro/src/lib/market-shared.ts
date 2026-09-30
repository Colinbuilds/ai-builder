// Market defaults usable on client and server.
import type { Scope } from "./projects/intake";

export type Market = "RESIDENTIAL" | "COMMERCIAL";

export const MARKET_DEFAULTS: Record<Market, { scopes: Scope[]; leadSources: string[] }> = {
  RESIDENTIAL: {
    scopes: ["STEEP"],
    leadSources: ["Storm canvass", "Referral", "Repeat customer", "Website", "Yard sign", "Insurance agent", "Home show"],
  },
  COMMERCIAL: {
    scopes: ["LOW_SLOPE"],
    leadSources: ["GC bid invite", "Public bid advertisement", "Property manager", "Repeat client", "Architect", "Referral"],
  },
};
