"use client";

import { useMemo, useState } from "react";
import { PLANS, commission, type CommissionPlanKey } from "@/lib/costing/commission";
import { Input, Select } from "@/components/ui/input";

type Job = { id: string; name: string; salesperson: string | null; contract: number; actual: number; projected: number; hasCosts: boolean; closed: boolean };

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const toNum = (v: string) => {
  const s = v.replace(/[$,%\s]/g, "");
  return s === "" ? NaN : Number(s);
};

export function CommissionCalculator({ jobs }: { jobs: Job[] }) {
  const [plan, setPlan] = useState<CommissionPlanKey>("10/60/40");
  const [contract, setContract] = useState("");
  const [jobCost, setJobCost] = useState("");
  const [custom, setCustom] = useState({ overheadPct: "10", companyPct: "60", repPct: "40" });
  const [jobId, setJobId] = useState("");
  const [costBasis, setCostBasis] = useState<"projected" | "actual">("projected");

  const job = jobs.find((j) => j.id === jobId) ?? null;
  const pick = (id: string, basis = costBasis) => {
    setJobId(id);
    const j = jobs.find((x) => x.id === id);
    if (!j) return;
    setContract(String(j.contract));
    setJobCost(String(basis === "actual" ? j.actual : j.projected));
  };
  const rates =
    plan === "CUSTOM"
      ? { overheadPct: toNum(custom.overheadPct), companyPct: toNum(custom.companyPct), repPct: toNum(custom.repPct) }
      : PLANS.find((p) => p.key === plan)!;
  const r = useMemo(() => commission({ contract: toNum(contract), jobCost: toNum(jobCost), ...rates }), [contract, jobCost, rates.overheadPct, rates.companyPct, rates.repPct]); // eslint-disable-line react-hooks/exhaustive-deps
  const touched = contract !== "" || jobCost !== "";

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="flex flex-col gap-3 rounded-lg border border-btr-line p-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Plan</span>
          <div className="flex flex-wrap gap-2">
            {[...PLANS.map((p) => p.key), "CUSTOM" as const].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setPlan(k)}
                aria-pressed={plan === k}
                className={`rounded-md border px-3 py-1.5 text-sm tabular-nums ${plan === k ? "border-btr-black bg-btr-black text-white" : "hover:bg-muted"}`}
              >
                {k === "CUSTOM" ? "Custom" : k}
              </button>
            ))}
          </div>
          {plan === "CUSTOM" && (
            <div className="mt-1 grid grid-cols-3 gap-2 text-xs">
              {(["overheadPct", "companyPct", "repPct"] as const).map((k) => (
                <label key={k} className="flex flex-col gap-1">
                  {k === "overheadPct" ? "Overhead %" : k === "companyPct" ? "Company %" : "Rep %"}
                  <Input
                    inputMode="decimal"
                    value={custom[k]}
                    onChange={(e) => {
                      const v = e.target.value;
                      const n = toNum(v);
                      setCustom((c) =>
                        k === "companyPct" && Number.isFinite(n)
                          ? { ...c, companyPct: v, repPct: String(100 - n) }
                          : k === "repPct" && Number.isFinite(n)
                            ? { ...c, repPct: v, companyPct: String(100 - n) }
                            : { ...c, [k]: v },
                      );
                    }}
                  />
                </label>
              ))}
            </div>
          )}
        </div>

        {jobs.length > 0 && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Fill in from a sold job (optional)</span>
            <Select value={jobId} onChange={(e) => pick(e.target.value)}>
              <option value="">— type the numbers yourself —</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                  {j.salesperson ? ` · ${j.salesperson}` : ""}
                  {j.closed ? " · closed" : ""}
                </option>
              ))}
            </Select>
            {job && (
              <span className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                Job cost from:
                {(["projected", "actual"] as const).map((b) => (
                  <label key={b} className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="basis"
                      checked={costBasis === b}
                      onChange={() => {
                        setCostBasis(b);
                        pick(job.id, b);
                      }}
                    />
                    {b === "projected" ? `projected (${usd(job.projected)})` : `bills so far (${usd(job.actual)})`}
                  </label>
                ))}
                {!job.hasCosts && <span className="text-destructive">No costs entered on this job yet.</span>}
              </span>
            )}
          </label>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Contract price</span>
          <Input inputMode="decimal" placeholder="$ sell price incl. approved change orders" value={contract} onChange={(e) => setContract(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Job cost</span>
          <Input inputMode="decimal" placeholder="$ materials + labor + dumpster, permits…" value={jobCost} onChange={(e) => setJobCost(e.target.value)} />
        </label>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-btr-line p-4" aria-live="polite">
        {!touched ? (
          <p className="text-sm text-muted-foreground">Enter a contract price and job cost, or pick a job.</p>
        ) : !r.ok ? (
          <ul className="list-disc pl-5 text-sm text-destructive">
            {r.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : (
          <>
            <div className="rounded-md bg-btr-black p-4 text-white">
              <div className="text-xs tracking-wide text-white/60 uppercase">Rep commission</div>
              <div className="text-3xl font-semibold tabular-nums">{usd(r.rep)}</div>
              <div className="text-xs text-white/60">{r.formulas.rep}</div>
            </div>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
              <Row label="Overhead" value={usd(r.overhead)} formula={r.formulas.overhead} />
              <Row label="Profit to split" value={usd(r.profit)} formula={`${r.formulas.profit} · ${r.marginPct}% of contract`} strong />
              <Row label="Company share" value={usd(r.company)} formula={r.formulas.company} />
              <Row label="Rep share" value={usd(r.rep)} formula={r.formulas.rep} />
            </dl>
            {r.lost && (
              <p className="rounded-md border border-btr-line bg-muted p-2 text-sm">
                This job doesn&apos;t clear overhead ({usd(r.profit)} after overhead), so there&apos;s no profit to split.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Row({ label, value, formula, strong }: { label: string; value: string; formula: string; strong?: boolean }) {
  return (
    <>
      <dt>
        <span className={strong ? "font-semibold" : ""}>{label}</span>
        <span className="block text-xs text-muted-foreground">{formula}</span>
      </dt>
      <dd className={`text-right tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </>
  );
}
