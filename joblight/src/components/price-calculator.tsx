"use client";

import Link from "next/link";
import { useState } from "react";
import { PRICING, monthlyFor, userRate, usd } from "@/lib/pricing";

export function PriceCalculator() {
  const [users, setUsers] = useState(5);
  const total = monthlyFor(users);
  return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <label htmlFor="users" className="text-sm font-medium">
        How many people will sign in?
      </label>
      <div className="mt-3 flex items-center gap-4">
        <input id="users" type="range" min={1} max={PRICING.maxStandardUsers + 1} value={users} onChange={(e) => setUsers(Number(e.target.value))} className="flex-1 accent-[var(--light-strong)]" />
        <span className="w-14 text-right text-lg font-semibold tabular-nums">{users > PRICING.maxStandardUsers ? `${PRICING.maxStandardUsers}+` : users}</span>
      </div>
      {total != null ? (
        <div className="mt-6">
          <p className="text-4xl font-bold tracking-tight">
            {usd(total)}
            <span className="text-base font-normal text-muted">/month</span>
          </p>
          <p className="mt-1 text-sm text-muted">
            {usd(total / users)} per user on average · user #{users} costs {usd(userRate(users))}
          </p>
        </div>
      ) : (
        <div className="mt-6">
          <p className="text-3xl font-bold tracking-tight">Custom rate</p>
          <p className="mt-1 text-sm text-muted">Over {PRICING.maxStandardUsers} users we set you up hands-on: data migration, training and integrations, priced for your team.</p>
        </div>
      )}
      <Link href={`/demo?users=${users}`} className="btn mt-6 w-full">
        {total != null ? "Book a demo" : "Talk to us"}
      </Link>
    </div>
  );
}
