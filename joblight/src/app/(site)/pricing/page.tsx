import type { Metadata } from "next";
import { Check } from "lucide-react";
import { PriceCalculator } from "@/components/price-calculator";
import { PRICING, monthlyFor, userRate, usd } from "@/lib/pricing";

export const metadata: Metadata = { title: "Pricing" };

const INCLUDED = [
  "Lumen AI assistant, set up with your shop's rules",
  "Jobs, estimates, proposals with e-signature",
  "Scheduling, crews and work orders",
  "Invoices, change orders and card payments",
  "Customer and crew portals",
  "Receipt and supplier-bill reading",
  "Job profit, cash and work-in-progress reports",
  "Your name, logo and colors throughout",
];

export default function PricingPage() {
  const rows = [1, 3, 5, 10, 15, 20];
  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <h1 className="text-4xl font-bold tracking-tight">One plan. Every feature. Cheaper as you grow.</h1>
      <p className="mt-3 max-w-2xl text-lg text-muted">
        The first user is {usd(PRICING.baseRate)}/month. Each person you add costs {Math.round(PRICING.stepDiscount * 100)}% less than the one before, down to {usd(PRICING.floorRate)}. Over{" "}
        {PRICING.maxStandardUsers} users, we quote a custom rate.
      </p>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_1.1fr]">
        <PriceCalculator />
        <div>
          <h2 className="font-semibold">Everything included</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {INCLUDED.map((i) => (
              <li key={i} className="flex gap-2 text-sm">
                <Check size={16} className="mt-0.5 shrink-0 text-ok" /> {i}
              </li>
            ))}
          </ul>
          <div className="mt-8 overflow-hidden rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-light-soft text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Team size</th>
                  <th className="px-3 py-2 font-medium">Last user</th>
                  <th className="px-3 py-2 text-right font-medium">Per month</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-surface">
                {rows.map((n) => (
                  <tr key={n}>
                    <td className="px-3 py-2">{n === 1 ? "1 user" : `${n} users`}</td>
                    <td className="px-3 py-2 text-muted">{usd(userRate(n))}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{usd(monthlyFor(n)!)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="px-3 py-2">{PRICING.maxStandardUsers + 1}+ users</td>
                  <td className="px-3 py-2 text-muted">—</td>
                  <td className="px-3 py-2 text-right font-medium">Custom</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-sm text-muted">
            One-time setup from {usd(PRICING.setupFrom)}: your branding, your trade&apos;s job stages and price lists, Lumen&apos;s rules, and bringing over your customers and open jobs.
          </p>
        </div>
      </div>
    </div>
  );
}
