import "server-only";
import { cookies } from "next/headers";

export type Market = "RESIDENTIAL" | "COMMERCIAL";
export type MarketView = Market | "ALL";
export const MARKET_COOKIE = "ep_market";
export const MARKET_LABEL: Record<Market, string> = { RESIDENTIAL: "Residential", COMMERCIAL: "Commercial" };

/** Which side of the business the user is looking at (header switch). */
export async function getMarketView(): Promise<MarketView> {
  const v = (await cookies()).get(MARKET_COOKIE)?.value;
  return v === "RESIDENTIAL" || v === "COMMERCIAL" ? v : "ALL";
}
