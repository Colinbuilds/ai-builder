import Link from "next/link";
import { FileUp, MousePointerClick } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { StartData } from "@/lib/builders/starts";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { readStartsAction } from "./actions";
import { housesAddress } from "@/lib/builders/starts-inbox";

// Adding a builder house, for anyone: drop in the builder's PDF, or pick the builder and model with big buttons.
export default async function AddHousePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const [builders, waiting, recent] = await Promise.all([
    prisma.company.findMany({ where: { type: "BUILDER", planBooks: { some: { active: true } } }, select: { id: true, name: true, planBooks: { where: { active: true }, select: { id: true, label: true } } }, orderBy: { name: "asc" } }),
    prisma.builderStart.findMany({ where: { status: "NEW" }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.builderStart.findMany({ where: { status: "SCHEDULED" }, orderBy: { scheduledAt: "desc" }, take: 8 }),
  ]);
  const say = (s: { data: unknown }) => {
    const d = s.data as StartData;
    return { where: [d.lot && `Lot ${d.lot}`, d.subdivision, d.address].filter(Boolean).join(" · ") || "(no address)", what: [d.builder, d.planCode && `Plan ${d.planCode}`, d.elevationCode && `Elev ${d.elevationCode}`].filter(Boolean).join(" · ") };
  };

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Add a builder house</h1>
        <p className="text-muted-foreground">Two ways. Either one makes the job and puts it on the production schedule.</p>
      </div>
      {sp.err && <p className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{sp.err}</p>}
      {sp.read && <p className="rounded-md border border-green-300 bg-green-50 p-3 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200">Read {sp.read} sheets. They&apos;re listed below — open each one and press “Yes, add this house”.</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-xl border-2 border-btr-blue/40 p-5">
          <div className="flex items-center gap-3">
            <FileUp size={32} className="text-btr-blue" />
            <h2 className="text-xl font-semibold">1. I have the builder&apos;s PDF</h2>
          </div>
          <p className="text-sm text-muted-foreground">The option sheet / start sheet the builder emailed (DR Horton&apos;s “Selected Option Summary”). BTRpro reads the lot, address, model and options for you.</p>
          <form action={readStartsAction} className="flex flex-col gap-3">
            <input name="pdf" type="file" accept="application/pdf,.pdf" multiple required className="rounded-md border-2 border-dashed p-4 text-base file:mr-3 file:rounded file:border-0 file:bg-btr-blue file:px-3 file:py-2 file:text-white" />
            <Button type="submit" size="lg" className="h-12 text-base">
              Read it
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">You can pick several PDFs at once. The same sheet is never added twice.</p>
          {housesAddress() && (
            <p className="rounded-md bg-muted/50 p-2 text-sm">
              Or just forward the builder&apos;s email to <span className="font-semibold">{housesAddress()}</span> — the sheets show up below, ready to add.
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-xl border-2 p-5">
          <div className="flex items-center gap-3">
            <MousePointerClick size={32} className="text-btr-blue" />
            <h2 className="text-xl font-semibold">2. Pick it myself</h2>
          </div>
          <p className="text-sm text-muted-foreground">Tap the builder, tap the model, tap the options, type the address.</p>
          {builders.length === 0 ? (
            <p className="text-sm">No builder has a plan book yet. Go to Builders → (the builder) → Plans &amp; models → Import.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {builders.map((b) => (
                <Link key={b.id} href={`/builders/${b.id}/plans`} className="flex items-center justify-between rounded-lg border px-4 py-3 text-lg font-medium hover:border-btr-blue hover:bg-btr-blue-soft">
                  {b.name}
                  <span className="text-sm font-normal text-muted-foreground">{b.planBooks.map((p) => p.label).join(", ")} →</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {waiting.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Read, waiting to be added ({waiting.length})</h2>
          {waiting.map((s) => {
            const t = say(s);
            return (
              <Link key={s.id} href={`/builders/add-house/${s.id}`} className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 hover:bg-muted/50">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{t.where}</span>
                  <span className="block truncate text-sm text-muted-foreground">{t.what}</span>
                </span>
                <span className="shrink-0 rounded-md bg-btr-blue px-3 py-1.5 text-sm text-white">Review &amp; add →</span>
              </Link>
            );
          })}
        </section>
      )}

      {recent.length > 0 && (
        <section className="flex flex-col gap-1 text-sm">
          <h2 className="font-semibold text-muted-foreground">Recently added from PDFs</h2>
          {recent.map((s) => (
            <span key={s.id} className="text-muted-foreground">
              {formatDate(s.scheduledAt)} — {say(s).where} ({say(s).what})
            </span>
          ))}
        </section>
      )}
    </div>
  );
}
