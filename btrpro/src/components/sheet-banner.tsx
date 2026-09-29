import Link from "next/link";
import { prisma } from "@/lib/db";
import { describeDateStatus, sheetDateStatus } from "@/lib/sheets/date-status";

// Dashboard banner for every live sheet that isn't CURRENT (BUILD_PROMPT §1).
export async function SheetDateBanner() {
  const sheets = await prisma.priceSheet.findMany({ where: { isActive: true, isLoaded: true }, orderBy: { code: "asc" } });
  const flagged = sheets
    .map((s) => ({ s, st: sheetDateStatus(s) }))
    .filter(({ st }) => st.status !== "CURRENT");
  if (!flagged.length) return null;
  const expired = flagged.some(({ st }) => st.status === "EXPIRED" || st.status === "UNKNOWN");
  return (
    <div
      className={
        expired
          ? "rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
          : "rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
      }
    >
      <p className="font-semibold">
        {flagged.length} price sheet{flagged.length === 1 ? " needs" : "s need"} attention before bid numbers are final.{" "}
        <Link href="/library/sheets" className="underline">
          Review sheets
        </Link>
      </p>
      <ul className="mt-2 list-disc pl-5">
        {flagged.map(({ s, st }) => (
          <li key={s.id}>
            <span className="font-medium">
              {s.code} {s.name}:
            </span>{" "}
            {st.status}. {describeDateStatus(st)}
          </li>
        ))}
      </ul>
    </div>
  );
}
