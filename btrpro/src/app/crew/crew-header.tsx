import Link from "next/link";
import { crewLogoutAction } from "./actions";

export function CrewHeader({ name, back }: { name: string; back?: boolean }) {
  return (
    <header className="-mx-3 -mt-4 mb-4 flex items-center gap-3 bg-btr-black px-4 py-3 text-white sm:-mx-4 sm:-mt-5">
      {back ? (
        <Link href="/crew" className="text-sm text-white/80">
          ← Jobs
        </Link>
      ) : (
        <span className="rounded bg-white px-1.5 py-0.5 text-sm font-black tracking-wider text-btr-black">BTR</span>
      )}
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
      <form action={crewLogoutAction}>
        <button className="text-sm text-white/70">Sign out</button>
      </form>
    </header>
  );
}
