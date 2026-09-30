import { setMarketView } from "@/app/projects/actions";
import type { MarketView } from "@/lib/market";

const OPTS: [MarketView, string][] = [
  ["ALL", "All"],
  ["RESIDENTIAL", "Residential"],
  ["COMMERCIAL", "Commercial"],
];

export function MarketSwitch({ view }: { view: MarketView }) {
  return (
    <form
      action={setMarketView}
      className="flex overflow-hidden rounded-md border text-xs"
    >
      {OPTS.map(([v, label]) => (
        <button
          key={v}
          name="market"
          value={v}
          aria-pressed={view === v}
          className={`px-3 py-1.5 ${view === v ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
        >
          {label}
        </button>
      ))}
    </form>
  );
}
