import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { pickers } from "@/lib/production/board";
import { ADD_ONS, builderNames, HOME_SCOPES, homeSchedule, materialsOf, modelsByBuilder, SCOPE_STATUS, statusOf, type House } from "@/lib/production/homes";
import { houseDescription } from "@/lib/production/house-text";
import { HouseRow, type RowHouse } from "@/components/production/house-row";
import { CreateJob } from "@/components/production/create-job";
import { NavSelect } from "@/components/dashboard/tab-select";

const day = (d: Date | null) => (d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : "");
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const STATUS_OPTIONS = Object.entries(SCOPE_STATUS) as [string, string][];

/** Plain data for the client row: statuses worked out here, dates as text. */
function rowOf(h: House): RowHouse {
  return {
    key: h.key,
    builder: h.builder,
    address: h.address,
    model: h.model,
    elevation: h.elevation,
    superName: h.superName,
    start: day(h.start) || null,
    description: houseDescription({ elevation: h.elevation, elevationType: h.elevationType, basement: h.basement, addOns: h.addOns }),
    houseInfo: h.houseInfo,
    planLine: h.plan,
    other: h.other.map((l) => l.type ?? "").filter(Boolean),
    scopes: Object.fromEntries(
      Object.entries(h.scopes).map(([sc, ls]) => [
        sc,
        ls!.map((l) => ({ id: l.id, status: statusOf(l), crew: l.crew, vpo: l.vpo, hasWo: !!l.workOrderUrl, materials: materialsOf(l), sell: l.sell, payout: l.payout, materialsSrc: l.materialsSrc, notes: l.notes })),
      ]),
    ),
  };
}

export default async function HomeCompanySchedule({ searchParams }: { searchParams: Promise<{ b?: string; new?: string; added?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const builders = await builderNames();
  const builder = sp.b && builders.includes(sp.b) ? sp.b : null;
  const [houses, models, { supers }] = await Promise.all([homeSchedule(builder), modelsByBuilder(), pickers()]);
  const canEdit = user.role !== "VIEWER";
  const href = (b: string | null) => `/production/homes${b ? `?b=${encodeURIComponent(b)}` : ""}`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl font-semibold">Home Company Schedule</h1>
        {builders.length > 0 && (
          <NavSelect label="Builder" value={href(builder)} className="h-8 w-52" options={[{ label: "All builders", href: href(null) }, ...builders.map((b) => ({ label: b, href: href(b) }))]} />
        )}
        <span className="text-xs text-muted-foreground" title="Each scope is a line on the main schedule. Job Done tells the office the crew can be paid; Sent to Billing tells them to bill the builder.">
          {houses.length} house{houses.length === 1 ? "" : "s"} ·{" "}
          <Link href="/production" className="text-btr-link hover:underline">
            main schedule
          </Link>
        </span>
        {sp.added && <span className="text-xs text-green-700 dark:text-green-300">Job created — its scopes are waiting for a crew.</span>}
        {canEdit && (
          <div className="ml-auto">
            <CreateJob defaultOpen={!!sp.new} builders={builders} models={models} supers={supers} scopes={HOME_SCOPES} addOnNames={ADD_ONS} builder={builder ?? undefined} />
          </div>
        )}
      </div>
      {houses.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open builder houses{builder ? ` for ${builder}` : ""} yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1 font-medium">Address</th>
                <th className="px-2 py-1 font-medium">Model</th>
                {HOME_SCOPES.map((sc) => (
                  <th key={sc} className="px-1 py-1 font-medium">
                    {sc}
                  </th>
                ))}
                <th className="px-2 py-1 text-right font-medium" title="Sell to the builder">
                  Sell
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {houses.map((h) => (
                <HouseRow key={h.key} h={rowOf(h)} scopes={HOME_SCOPES} options={STATUS_OPTIONS} canEdit={canEdit} showBuilder={!builder} />
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/30 text-xs">
              <tr>
                <td className="px-2 py-1" colSpan={2 + HOME_SCOPES.length}>
                  {houses.length} house{houses.length === 1 ? "" : "s"}
                </td>
                <td className="px-2 py-1 text-right font-medium whitespace-nowrap tabular-nums">{usd(houses.flatMap((h) => h.lines).reduce((a, l) => a + (l.sell ?? 0), 0))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
