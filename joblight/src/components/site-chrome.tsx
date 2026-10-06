import Link from "next/link";
import { Logo } from "./logo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Link href="/" aria-label="Joblight home">
          <Logo />
        </Link>
        <nav className="ml-auto flex items-center gap-1 text-sm sm:gap-3">
          <Link href="/#features" className="hidden px-2 py-1 text-muted hover:text-ink sm:inline">
            Features
          </Link>
          <Link href="/#trades" className="hidden px-2 py-1 text-muted hover:text-ink sm:inline">
            Trades
          </Link>
          <Link href="/pricing" className="px-2 py-1 text-muted hover:text-ink">
            Pricing
          </Link>
          <Link href="/demo" className="btn h-9">
            Book a demo
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-8 text-sm text-muted">
        <Logo className="text-ink" />
        <span>The AI-run CRM for the trades.</span>
        <Link href="/console" className="ml-auto hover:text-ink">
          Operator sign-in
        </Link>
      </div>
    </footer>
  );
}
