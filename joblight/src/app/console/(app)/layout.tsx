import Link from "next/link";
import { Logo } from "@/components/logo";
import { requireOperator } from "@/lib/auth";
import { logout } from "../actions";

export const metadata = { title: "Console", robots: { index: false } };

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const op = await requireOperator();
  return (
    <div className="min-h-screen">
      <header className="bg-night text-night-ink">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 text-sm">
          <Link href="/console">
            <Logo />
          </Link>
          <span className="rounded bg-white/10 px-2 py-0.5 text-xs">Console</span>
          <nav className="flex gap-3 text-night-ink/80">
            <Link href="/console" className="hover:text-night-ink">
              Buildouts
            </Link>
            <Link href="/console/leads" className="hover:text-night-ink">
              Leads
            </Link>
            <Link href="/" className="hover:text-night-ink">
              Public site
            </Link>
          </nav>
          <form action={logout} className="ml-auto flex items-center gap-3">
            <span className="hidden text-night-ink/60 sm:inline">{op.email}</span>
            <button className="rounded border border-white/20 px-2 py-1 hover:bg-white/10">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
