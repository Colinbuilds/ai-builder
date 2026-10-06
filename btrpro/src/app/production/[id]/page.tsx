import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { pickers, PROD_BOARDS } from "@/lib/production/board";
import { ProdForm } from "@/components/production/prod-forms";
import { deleteProdAction } from "../actions";
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
