import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { EDIT_ROLES } from "@/lib/roles";
import { BOARD_LABEL, PRIORITIES } from "@/lib/estimating/schedule";
import { EntryForm } from "@/components/estimating/schedule-forms";

export default async function NewScheduleEntry({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  await requireUser(EDIT_ROLES);
  const m = (await searchParams).m === "residential" ? "RESIDENTIAL" : "COMMERCIAL";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3">
        <Link href={`/estimating/schedule?m=${m.toLowerCase()}`} className="text-sm text-muted-foreground hover:underline">
          ← Estimating schedule
        </Link>
        <h1 className="text-2xl font-semibold">New bid</h1>
      </div>
      <EntryForm
        v={{ board: "CURRENT", market: m, kind: m === "RESIDENTIAL" ? "NEW_BUILD" : null, receivedAt: new Date() }}
        boards={Object.entries(BOARD_LABEL)}
        priorities={Object.entries(PRIORITIES)}
      />
    </div>
  );
}
