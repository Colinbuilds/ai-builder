import { requireUser } from "@/lib/auth";
import { setupChecks } from "@/lib/setup-check";

const STYLE = {
  ok: ["✓", "text-green-700 dark:text-green-400"],
  missing: ["✗", "text-red-600"],
  problem: ["!", "text-amber-700 dark:text-amber-400"],
  optional: ["–", "text-muted-foreground"],
} as const;

export default async function SetupPage() {
  await requireUser(["ADMIN"]);
  const checks = setupChecks();
  const order = { missing: 0, problem: 1, optional: 2, ok: 3 };
  checks.sort((a, b) => order[a.status] - order[b.status]);
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Setup check</h1>
        <p className="text-sm text-muted-foreground">
          What&apos;s configured on the server (Railway → your service → Variables). Values are never shown here. After changing a variable, Railway redeploys;
          reload this page to re-check.
        </p>
      </div>
      <ul className="divide-y rounded-md border text-sm">
        {checks.map((c) => (
          <li key={c.name} className="grid grid-cols-[24px_1fr] gap-2 px-3 py-2.5">
            <span className={`font-bold ${STYLE[c.status][1]}`}>{STYLE[c.status][0]}</span>
            <div className="min-w-0">
              <div className="font-medium">{c.name}</div>
              <div className="text-muted-foreground">{c.what}</div>
              {c.fix && <div className="mt-0.5">{c.fix}</div>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
