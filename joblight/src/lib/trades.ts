// Trades Joblight is sold to. Setup configures the job stages, AI rules and templates for the company's trade.
export const TRADES = [
  { key: "roofing", label: "Roofing & exteriors" },
  { key: "hvac", label: "HVAC" },
  { key: "electrical", label: "Electrical" },
  { key: "plumbing", label: "Plumbing" },
  { key: "irrigation", label: "Irrigation & landscaping" },
  { key: "detailing", label: "Auto detailing" },
  { key: "auto-repair", label: "Auto repair & mechanics" },
  { key: "general", label: "General contracting" },
  { key: "other", label: "Another trade" },
] as const;

export const tradeLabel = (k: string) => TRADES.find((t) => t.key === k)?.label ?? k;
