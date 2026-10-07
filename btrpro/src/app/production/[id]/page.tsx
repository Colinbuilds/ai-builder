import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { pickers, PROD_BOARDS } from "@/lib/production/board";
import { ProdForm } from "@/components/production/prod-forms";
import { deleteProdAction, stepAction } from "../actions";
import { BILLING_ROLES } from "@/lib/roles";
import { appName } from "@/lib/company-profile";

export default async function ProdLinePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const l = await prisma.prodLine.findUnique({ where: { id } });
  if (!l) notFound();
  const { crews, supers } = await pickers();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <Link href="/production" className="text-sm text-muted-foreground hover:underline">
          ← Schedule
        </Link>
        <h1 className="text-2xl font-semibold">{l.location ?? l.builder}</h1>
        <span className="text-sm text-muted-foreground">
          {[l.builder, l.type].filter(Boolean).join(" · ")}
          {l.source === "SHEET" ? ` · from the sheet (${l.sourceTab}, row ${l.sourceRow})` : l.sourceKey ? ` · edited in ${appName()} (the sheet sync leaves it alone)` : ` · added in ${appName()}`}
        </span>
      </div>
      {(() => {
        // where this house / job is: done → crew paid → billed → paid, with one button for the next step
        const steps = [
          { key: "complete", label: "Work done", at: l.completed },
          { key: "approve", label: "Crew paid", at: l.approved },
          { key: "bill", label: "Billed", at: l.billed },
          { key: "paid", label: "Paid to us", at: l.btrPaid },
        ] as const;
        const next = steps.find((x) => !x.at);
        const canStep = next && (next.key === "complete" ? user.role !== "VIEWER" : (BILLING_ROLES as readonly string[]).includes(user.role));
        return (
          <div className="flex flex-col gap-3 rounded-xl border p-4">
            <ol className="grid grid-cols-4 gap-2 text-center text-sm">
              {steps.map((x, i) => (
                <li key={x.key} className={`rounded-lg border px-2 py-2 ${x.at ? "border-green-600 bg-green-50 dark:bg-green-950" : x === next ? "border-btr-blue" : "text-muted-foreground"}`}>
                  <div className="font-medium">
                    {i + 1}. {x.label}
                  </div>
                  <div className="truncate text-xs">{x.at ?? "—"}</div>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center gap-3">
              {next && canStep && (
                <form action={stepAction}>
                  <input type="hidden" name="id" value={l.id} />
                  <input type="hidden" name="step" value={next.key} />
                  <button type="submit" className="rounded-lg bg-btr-blue px-5 py-3 text-base font-semibold text-white hover:opacity-90">
                    Mark “{next.label}”
                  </button>
                </form>
              )}
              {!next && <span className="font-medium text-green-700">All four steps are done.</span>}
              {l.projectId && (
                <Link href={`/projects/${l.projectId}`} className="text-sm text-btr-link underline">
                  Open the job →
                </Link>
              )}
            </div>
          </div>
        );
      })()}
      {user.role === "VIEWER" ? (
        <p className="text-sm text-muted-foreground">View only.</p>
      ) : (
        <>
          <ProdForm v={l} back="/production" crews={crews} supers={supers} boards={Object.entries(PROD_BOARDS)} />
          <form action={deleteProdAction} className="border-t pt-3">
            <input type="hidden" name="id" value={l.id} />
            <button className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">Delete line</button>
          </form>
        </>
      )}
    </div>
  );
}
