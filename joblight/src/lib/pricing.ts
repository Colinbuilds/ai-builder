// Joblight pricing. One place to change the numbers; the pricing page, the calculator and the console all read it.
// Per user: the first user is the base rate, each added user costs 5% less than the one before, never below the
// floor. Above 20 users the rate is custom (more hands-on onboarding).
export const PRICING = {
  baseRate: 99,
  stepDiscount: 0.05,
  floorRate: 40,
  maxStandardUsers: 20,
  setupFrom: 500,
} as const;

const cents = (n: number) => Math.round(n * 100) / 100;

/** What the nth user (1-based) costs per month. */
export function userRate(n: number, p = PRICING): number {
  return cents(Math.max(p.floorRate, p.baseRate * (1 - p.stepDiscount) ** (n - 1)));
}

/** Monthly total for a company; null when it's a custom quote (over the standard limit). */
export function monthlyFor(users: number, p = PRICING): number | null {
  const n = Math.floor(users);
  if (!Number.isFinite(n) || n < 1) throw new Error("At least one user.");
  if (n > p.maxStandardUsers) return null;
  let total = 0;
  for (let i = 1; i <= n; i++) total += userRate(i, p);
  return cents(total);
}

/** What a buildout pays: its agreed rate, else the schedule. */
export function buildoutMonthly(b: { users: number; customMonthly: number | null; status: string }): number | null {
  if (b.status === "CANCELLED" || b.status === "PAUSED") return 0;
  return b.customMonthly ?? monthlyFor(b.users);
}

export const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 });
