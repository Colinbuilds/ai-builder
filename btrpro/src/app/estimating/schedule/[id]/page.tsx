import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { BOARD_LABEL, PRIORITIES } from "@/lib/estimating/schedule";
import { EntryForm } from "@/components/estimating/schedule-forms";
import { deleteEntryAction, startJobAction } from "../actions";

export default async function ScheduleEntry({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const e = await prisma.estimateLog.findUnique({ where: { id } });
  if (!e) notFound();
  const extra = Object.entries((e.extra as Record<string, string> | null) ?? {});
  const canEdit = user.role !== "VIEWER";
  const back = `/estimating/schedule?m=${e.market === "RESIDENTIAL" ? "residential" : "commercial"}`;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <Link href={back} className="text-sm text-muted-foreground hover:underline">
          ← Estimating schedule
        </Link>
        <h1 className="text-2xl font-semibold">{e.project}</h1>
        <span className="text-sm text-muted-foreground">
          {BOARD_LABEL[e.board as keyof typeof BOARD_LABEL] ?? e.board}
          {e.source === "SHEET" ? ` · from the sheet (${e.sourceTab?.trim()}, row ${e.sourceRow})` : e.sourceKey ? " · edited in BTRpro (the sheet sync leaves it alone)" : " · added in BTRpro"}
          {e.updatedBy && ` · last edit ${e.updatedBy}`}
        </span>
      </div>
      {extra.length > 0 && (
        <dl className="grid max-w-4xl gap-x-6 gap-y-1 rounded-md border p-3 text-sm sm:grid-cols-2">
          {extra.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="text-muted-foreground">{k}:</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {canEdit ? (
        <>
          <EntryForm v={e} boards={Object.entries(BOARD_LABEL)} priorities={Object.entries(PRIORITIES)} />
          <div className="flex flex-wrap gap-3 border-t pt-3">
            {e.projectId ? (
              <Link href={`/projects/${e.projectId}`} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
                Open the job
              </Link>
            ) : (
              <form action={startJobAction}>
                <input type="hidden" name="id" value={e.id} />
                <button className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">Start a job in BTRpro from this bid</button>
              </form>
            )}
            <form action={deleteEntryAction} className="ml-auto">
              <input type="hidden" name="id" value={e.id} />
              <input type="hidden" name="market" value={e.market} />
              <button className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">Delete row</button>
            </form>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">View only.</p>
      )}
    </div>
  );
}
