// Where a job's money goes: a donut of materials, sales tax, crew/labor, other costs and profit, with direct labels,
// a legend and a table of exact amounts (so nothing is read from color alone). Server-rendered SVG; hover shows the
// slice's amount. Palette validated (light + dark, adjacent pairs incl. the wrap-around) with the dataviz checker.
import { formatUsd } from "@/lib/utils";

import { moneySlices, type Slice } from "@/lib/costing/split";

export { moneySlices, type Slice };

const ORDER: Slice["key"][] = ["materials", "tax", "labor", "other", "profit"];

const R = 70;
const W = 26;
const C = 2 * Math.PI * R;

export function MoneyDonut({ title, slices, loss = 0, center, centerNote }: { title: string; slices: Slice[]; loss?: number; center: string; centerNote: string }) {
  const sorted = ORDER.map((k) => slices.find((s) => s.key === k)).filter((s): s is Slice => !!s);
  const total = sorted.reduce((a, s) => a + s.value, 0);
  const pct = (v: number) => (total ? Math.round((v / total) * 1000) / 10 : 0);
  let at = 0;
  const gap = sorted.length > 1 ? 2 : 0; // 2px surface gap between slices
  return (
    <figure className="money-donut flex flex-col gap-3 rounded-lg border bg-background p-4">
      <style>{`
        .money-donut { --s-materials:#2a78d6; --s-tax:#eda100; --s-labor:#4a3aa7; --s-other:#eb6834; --s-profit:#1baf7a; --s-surface: var(--background, #fff); }
        @media (prefers-color-scheme: dark) { :root:where(:not([data-theme="light"])) .money-donut { --s-materials:#3987e5; --s-tax:#c98500; --s-labor:#9085e9; --s-other:#d95926; --s-profit:#199e70; } }
        :root[data-theme="dark"] .money-donut { --s-materials:#3987e5; --s-tax:#c98500; --s-labor:#9085e9; --s-other:#d95926; --s-profit:#199e70; }
        .money-donut circle.slice { transition: stroke-width .12s; cursor: default; }
        .money-donut circle.slice:hover { stroke-width: ${W + 6}px; }
      `}</style>
      <figcaption className="text-sm font-semibold">{title}</figcaption>
      {total <= 0 ? (
        <p className="text-sm text-muted-foreground">Nothing to show yet.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-6">
          <svg viewBox="0 0 200 200" width="200" height="200" role="img" aria-label={`${title}: ${sorted.map((s) => `${s.label} ${formatUsd(s.value)} (${pct(s.value)}%)`).join(", ")}`}>
            <g transform="rotate(-90 100 100)">
              {sorted.map((s) => {
                const len = (s.value / total) * C;
                const el = (
                  <circle key={s.key} className="slice" cx="100" cy="100" r={R} fill="none" stroke={`var(--s-${s.key})`} strokeWidth={W} strokeDasharray={`${Math.max(0, len - gap)} ${C}`} strokeDashoffset={-at}>
                    <title>{`${s.label}: ${formatUsd(s.value)} (${pct(s.value)}%)`}</title>
                  </circle>
                );
                at += len;
                return el;
              })}
            </g>
            <text x="100" y="96" textAnchor="middle" className="fill-foreground" style={{ fontSize: 18, fontWeight: 600 }}>
              {center}
            </text>
            <text x="100" y="116" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 11 }}>
              {centerNote}
            </text>
          </svg>
          <table className="min-w-[220px] flex-1 text-sm">
            <tbody>
              {sorted.map((s) => (
                <tr key={s.key} className="border-b last:border-0">
                  <td className="py-1.5 pr-2">
                    <span className="mr-2 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: `var(--s-${s.key})` }} aria-hidden />
                    {s.label}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{formatUsd(s.value)}</td>
                  <td className="w-14 py-1.5 text-right text-muted-foreground tabular-nums">{pct(s.value)}%</td>
                </tr>
              ))}
              {loss > 0 && (
                <tr>
                  <td className="py-1.5 pr-2 font-medium text-red-700">Loss (costs over the sell)</td>
                  <td className="py-1.5 text-right font-medium text-red-700 tabular-nums">−{formatUsd(loss)}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
