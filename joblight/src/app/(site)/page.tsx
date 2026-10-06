import Link from "next/link";
import { Bot, Calendar, ClipboardList, FileSignature, Gauge, Receipt, Ruler, Smartphone, Users, Wallet, Wrench, Zap } from "lucide-react";
import { PRICING, monthlyFor, usd } from "@/lib/pricing";
import { TRADES } from "@/lib/trades";

const FEATURES = [
  { icon: Bot, title: "Lumen, your AI office hand", text: "Ask about any job and get answers from your own records. Lumen drafts estimates, reads receipts and contracts, and follows the rules you set — it never guesses a price." },
  { icon: ClipboardList, title: "Every job in one place", text: "Leads to paid in one pipeline: contacts, photos, documents, notes and a running activity log on every job." },
  { icon: Ruler, title: "Estimates and takeoffs", text: "Price from your own price lists, measure from plan sheets, and flag anything missing before it goes out." },
  { icon: FileSignature, title: "Proposals customers sign online", text: "Branded proposals with options. Customers pick, sign on their phone, and the job moves to sold." },
  { icon: Calendar, title: "Scheduling and crews", text: "Put work on the calendar, send crews their work orders by link, and see who's where." },
  { icon: Wallet, title: "Invoices and card payments", text: "Deposits, progress billing, change orders and online payment. Overdue balances surface on their own." },
  { icon: Receipt, title: "Receipts and supplier bills", text: "Snap a receipt; Lumen reads it, finds the job and checks the price against what you expected to pay." },
  { icon: Gauge, title: "Numbers that run the business", text: "Job profit, work in progress, a 13-week cash view and the dates that cost money when they slip." },
  { icon: Smartphone, title: "Customer and crew portals", text: "Customers see their proposal, schedule and invoices; crews see their jobs. No app to install." },
];

const STEPS = [
  { title: "Book a demo", text: "We walk through Joblight with your own kind of jobs." },
  { title: "We build yours", text: "Your name, logo and colors, your trade's job stages, your price lists and your rules for Lumen. Your customers and jobs come with you." },
  { title: "Run your shop", text: "Your team signs in on day one. Add people any time — every user after the first costs less." },
];

export default function Home() {
  const five = monthlyFor(5)!;
  return (
    <>
      {/* hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-16 pb-12 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
        <div>
          <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-light-soft px-3 py-1 text-xs font-semibold text-light-strong">
            <Zap size={14} /> AI-run CRM for the trades
          </p>
          <h1 className="text-4xl leading-[1.08] font-bold tracking-tight text-balance sm:text-5xl">Light up every job, from first call to final payment.</h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            Joblight runs the office side of your trade — leads, estimates, scheduling, invoicing — with an AI assistant that works from your own records and follows your shop&apos;s rules.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/demo" className="btn h-11 px-5">
              Book a demo
            </Link>
            <Link href="/pricing" className="btn-ghost h-11 px-5">
              See pricing
            </Link>
          </div>
          <p className="mt-4 text-sm text-muted">
            Your brand, your rules. {usd(PRICING.baseRate)}/month for the first user, less for every user after.
          </p>
        </div>
        <AppPreview />
      </section>

      {/* features */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
        <h2 className="text-3xl font-bold tracking-tight">Everything the office does, done faster</h2>
        <p className="mt-2 max-w-2xl text-muted">One system for the whole job, set up with your trade's stages, line items and rules.</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-line bg-surface p-5">
              <f.icon className="text-light-strong" size={22} />
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* trades */}
      <section id="trades" className="scroll-mt-20 bg-night text-night-ink">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-3xl font-bold tracking-tight">Built for the work you do</h2>
          <p className="mt-2 max-w-2xl text-night-ink/70">
            Every trade runs on the same loop — lead, quote, schedule, do the work, get paid. Joblight is set up with your trade&apos;s job stages, line items and rules, so Lumen talks like your best office manager.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            {TRADES.filter((t) => t.key !== "other").map((t) => (
              <span key={t.key} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm">
                <Wrench size={14} className="text-light" /> {t.label}
              </span>
            ))}
            <span className="inline-flex items-center rounded-full border border-dashed border-white/25 px-4 py-2 text-sm text-night-ink/70">and yours</span>
          </div>
        </div>
      </section>

      {/* how it works */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-3xl font-bold tracking-tight">Up and running without the runaround</h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-xl border border-line bg-surface p-5">
              <span className="grid size-8 place-items-center rounded-full bg-light text-sm font-bold text-night">{i + 1}</span>
              <h3 className="mt-3 font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-sm text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* pricing teaser */}
      <section className="mx-auto max-w-6xl px-4">
        <div className="flex flex-col items-start gap-6 rounded-2xl border border-line bg-surface p-8 md:flex-row md:items-center">
          <div className="flex-1">
            <h2 className="text-2xl font-bold tracking-tight">Pay for your team, not for features</h2>
            <p className="mt-2 text-muted">
              Every feature and Lumen included. {usd(PRICING.baseRate)} for the first user, each added user {Math.round(PRICING.stepDiscount * 100)}% less than the one before. A 5-person shop is{" "}
              {usd(five)}/month. No add-on fees.
            </p>
          </div>
          <Link href="/pricing" className="btn h-11 px-5">
            <Users size={16} /> Price your team
          </Link>
        </div>
      </section>
    </>
  );
}

/** A static look at the app: today's board and a Lumen exchange. Illustrative, not live data. */
function AppPreview() {
  const cols = [
    { name: "Quoted", jobs: [["Ridgeview AC swap", "$8,400"], ["Lot 14 rough-in", "$12,950"]] },
    { name: "Scheduled", jobs: [["Maple St. panel", "Tue"], ["Oak Ct. irrigation", "Wed"]] },
    { name: "Invoiced", jobs: [["Hillcrest detail", "Paid"], ["Elm reroof", "Due 9d"]] },
  ];
  return (
    <div className="rounded-2xl border border-line bg-surface p-3 shadow-[0_20px_60px_-20px_rgba(18,21,28,0.35)]" aria-label="Example of the Joblight app">
      <div className="flex items-center gap-1.5 border-b border-line px-2 pb-3">
        <span className="size-2.5 rounded-full bg-line" />
        <span className="size-2.5 rounded-full bg-line" />
        <span className="size-2.5 rounded-full bg-line" />
        <span className="ml-3 text-xs text-muted">Today · 3 jobs need you</span>
      </div>
      <div className="grid grid-cols-3 gap-2 p-2">
        {cols.map((c) => (
          <div key={c.name} className="rounded-lg bg-bg p-2">
            <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">{c.name}</p>
            {c.jobs.map(([n, v]) => (
              <div key={n} className="mt-2 rounded-md border border-line bg-surface p-2">
                <p className="truncate text-xs font-medium">{n}</p>
                <p className="text-[11px] text-muted">{v}</p>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="m-2 rounded-lg bg-night p-3 text-night-ink">
        <p className="text-xs text-night-ink/60">You</p>
        <p className="text-sm">What&apos;s still missing on the Ridgeview quote?</p>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-light">
          <Bot size={13} /> Lumen
        </p>
        <p className="text-sm">Two things: the condenser model isn&apos;t confirmed, and the line-set length is marked MISSING. Everything else is priced from your current list.</p>
      </div>
    </div>
  );
}
