import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { pickers, PROD_BOARDS } from "@/lib/production/board";
import { ProdForm } from "@/components/production/prod-forms";

export default async function NewProdLine({ searchParams }: { searchParams: Promise<{ crew?: string; superName?: string }> }) {
  await requireUser(STAFF_ROLES);
  const sp = await searchParams;
  const { crews, supers } = await pickers();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3">
        <Link href="/production" className="text-sm text-muted-foreground hover:underline">
          ← Schedule
        </Link>
        <h1 className="text-2xl font-semibold">Add a job to the schedule</h1>
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Same information as a new row on the live schedule: builder, address, model, type, crew, super, sales rep, pay out and sell. Lines added here start in &quot;New — to
        be placed&quot; unless you pick another list.
      </p>
      <ProdForm
        v={{ market: "RESIDENTIAL", board: sp.crew ? "CURRENT" : "ADD", crew: sp.crew, superName: sp.superName, salesRep: "House", dateAdded: new Date() }}
        back={sp.crew ? `/production?v=crew&who=${encodeURIComponent(sp.crew)}` : sp.superName ? `/production?v=pm&who=${encodeURIComponent(sp.superName)}` : "/production"}
        crews={crews}
        supers={supers}
        boards={Object.entries(PROD_BOARDS)}
      />
    </div>
  );
}
