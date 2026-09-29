// Rules engine (BUILD_PROMPT §7): evaluates the company rules against an estimate on every view.
import { prisma } from "@/lib/db";
import { parseScopes } from "@/lib/projects/intake";
import { SIDING_DEFAULT_PRODUCTS } from "@/lib/calc/siding";
import type { TakeoffConfig } from "./takeoff";

export type RuleResult = {
  id: string;
  text: string;
  locked: boolean;
  status: "pass" | "fail" | "info";
  message: string;
  fix?: { kind: "run_takeoff"; module: "steep" | "lowSlope" | "siding"; label: string } | { kind: "link"; href: string; label: string };
};

type Line = { calcKey: string | null; supplierItemNumber: string | null; quantity: number | null; ruleId: string | null; itemName: string; substitution: boolean };
type Ctx = {
  projectId: string;
  market: string;
  scopes: string[];
  isPublic: boolean;
  isTaxExempt: boolean;
  form17Status: string;
  lines: Line[];
  takeoff: TakeoffConfig;
  roofArea: { confirmed: boolean; rejectedByRule01: boolean };
  cheapestWrap: string | null;
};

const has = (lines: Line[], pred: (l: Line) => boolean) => lines.find(pred);
const qty = (l?: Line) => (l?.quantity != null ? `${l.quantity}` : "MISSING");

export function evaluateRules(ctx: Ctx, rules: { id: string; text: string; locked: boolean; active: boolean }[]): RuleResult[] {
  const out: RuleResult[] = [];
  const resShingle = ctx.market === "RESIDENTIAL" && ctx.scopes.includes("STEEP");
  const lowSlope = ctx.takeoff.lowSlope;
  const siding = ctx.scopes.includes("SIDING");
  const push = (r: Omit<RuleResult, "text" | "locked">) => {
    const def = rules.find((x) => x.id === r.id);
    if (def && def.active) out.push({ ...r, text: def.text, locked: def.locked });
  };
  const runSteep = { kind: "run_takeoff" as const, module: "steep" as const, label: "Run steep takeoff" };

  if (ctx.scopes.some((s) => ["STEEP", "LOW_SLOPE", "DECK"].includes(s)))
    push({
      id: "ROOF-01",
      status: ctx.roofArea.confirmed ? "pass" : "fail",
      message: ctx.roofArea.confirmed
        ? "Roof area is a confirmed roof-plan / EagleView / field value."
        : ctx.roofArea.rejectedByRule01
          ? "Only a floor-plan schedule area was found and it was rejected. Need the roof plan sheet or EagleView."
          : "No confirmed roof area yet.",
      fix: ctx.roofArea.confirmed ? undefined : { kind: "link", href: `/projects/${ctx.projectId}/documents`, label: "Go to documents" },
    });

  if (resShingle) {
    const coil = has(ctx.lines, (l) => l.supplierItemNumber === "0150080011" || l.ruleId === "ROOF-02");
    push({ id: "ROOF-02", status: coil?.quantity ? "pass" : "fail", message: coil ? `Coil nails ${qty(coil)} BX` : "Coil nails missing", fix: coil?.quantity ? undefined : runSteep });
    const cap = has(ctx.lines, (l) => l.supplierItemNumber === "4292804534" || l.ruleId === "ROOF-03");
    push({ id: "ROOF-03", status: cap?.quantity ? "pass" : "fail", message: cap ? `Cap nails present — ${qty(cap)} BX` : "Cap nails missing", fix: cap?.quantity ? undefined : runSteep });
    const rv = has(ctx.lines, (l) => l.ruleId === "ROOF-04" || l.calcKey === "steep:ridge_vent");
    push({ id: "ROOF-04", status: rv ? "pass" : "fail", message: rv ? `Ridge vent included${rv.quantity == null ? " (needs product/coverage)" : ` — ${qty(rv)}`}` : "Ridge vent missing", fix: rv ? undefined : runSteep });
    const st = has(ctx.lines, (l) => l.calcKey === "steep:starter");
    push({ id: "ROOF-05", status: st ? "pass" : "fail", message: st ? "Starter figured on eaves + rakes" : "Starter strip missing", fix: st ? undefined : runSteep });
    const sh = has(ctx.lines, (l) => l.calcKey === "steep:shingles");
    const defaults = ["02MLVIA3AB", "03CTLCF3WW"];
    push({
      id: "ROOF-06",
      status: "info",
      message: !sh?.supplierItemNumber
        ? "Pick the shingle: Malarkey Vista AR (02MLVIA3AB) or CertainTeed Landmark ClimateFlex (03CTLCF3WW) when the brand isn't specified."
        : defaults.includes(sh.supplierItemNumber)
          ? `Using a company 30-yr default (${sh.supplierItemNumber}).`
          : `Using ${sh.supplierItemNumber} — make sure the brand was specified.`,
    });
    const hr = has(ctx.lines, (l) => l.calcKey === "steep:hip_ridge");
    push({ id: "ROOF-07", status: hr ? "pass" : "fail", message: hr ? `H&R at 25 LF/BD — ${qty(hr)} BD` : "Hip & ridge missing", fix: hr ? undefined : runSteep });
  }

  if (lowSlope?.system === "EPDM") {
    const cb = has(ctx.lines, (l) => l.calcKey === "lowSlope:cover_board");
    push({
      id: "ROOF-08",
      status: cb?.supplierItemNumber ? "pass" : "fail",
      message: cb?.supplierItemNumber ? `Cover board included — ${qty(cb)}` : "EPDM cover board missing (it's always a standard line)",
      fix: cb?.supplierItemNumber ? undefined : { kind: "run_takeoff", module: "lowSlope", label: "Add cover board in takeoff" },
    });
    if (lowSlope.preSecured) {
      const f = has(ctx.lines, (l) => l.calcKey === "lowSlope:presecure_fasteners");
      const p = has(ctx.lines, (l) => l.calcKey === "lowSlope:presecure_plates");
      const ok = !!(f?.quantity && p?.quantity);
      push({
        id: "ROOF-09",
        status: ok ? "pass" : "fail",
        message: ok ? `Pre-securement fasteners ${qty(f)} and plates ${qty(p)}` : "Pre-securement fasteners/plates missing",
        fix: ok ? undefined : { kind: "run_takeoff", module: "lowSlope", label: "Run low-slope takeoff" },
      });
    }
  }
  const placeholders = ctx.lines.filter((l) => l.itemName.includes("PLACEHOLDER"));
  if (placeholders.length) push({ id: "ROOF-10", status: "info", message: `${placeholders.length} placeholder line(s) — replace once EagleView measurements arrive.` });

  if (siding) {
    const s = has(ctx.lines, (l) => l.calcKey === "siding:siding");
    push({ id: "SID-01", status: s ? "pass" : "fail", message: s ? "Siding figured on EagleView Siding area only; masonry excluded." : "Siding line missing", fix: s ? undefined : { kind: "run_takeoff", module: "siding", label: "Run siding takeoff" } });
    push({ id: "SID-02", status: "info", message: "Openings are already out of the EagleView siding area; stone/stucco deductions only if the GC defines them." });
    const plank = ctx.takeoff.siding?.plank.itemNumber;
    push({
      id: "SID-03",
      status: "info",
      message: !plank ? "No siding product picked." : Object.values(SIDING_DEFAULT_PRODUCTS).includes(plank) ? `8.25" HardiePlank default (${plank}).` : `Using ${plank} — make sure the product was specified.`,
    });
    const wrap = has(ctx.lines, (l) => l.calcKey === "siding:house_wrap");
    const ok = !!wrap && (!ctx.cheapestWrap || wrap.supplierItemNumber === ctx.cheapestWrap || wrap.substitution);
    push({
      id: "SID-04",
      status: ok ? "pass" : "fail",
      message: !wrap ? "House wrap missing" : ok ? `House wrap ${wrap.supplierItemNumber} is the cheapest on the sheet${wrap.substitution ? " (approved substitution)" : ""}.` : `Cheapest wrap on the sheet is ${ctx.cheapestWrap}; ${wrap.supplierItemNumber} is more per SF.`,
      fix: ok ? undefined : { kind: "run_takeoff", module: "siding", label: "Run siding takeoff" },
    });
  }

  if (ctx.isPublic && ctx.isTaxExempt)
    push({
      id: "PUB-01",
      status: ctx.form17Status === "EXECUTED" ? "pass" : "fail",
      message: ctx.form17Status === "EXECUTED" ? "Form 17 executed." : "Form 17 not executed — no material purchases until it is.",
      fix: ctx.form17Status === "EXECUTED" ? undefined : { kind: "link", href: `/projects/${ctx.projectId}`, label: "Record Form 17" },
    });
  if (ctx.isPublic) push({ id: "PUB-02", status: "info", message: "Pull bid tabs after the opening and record them under Calibration." });
  return out;
}

export async function rulesForEstimate(estimateId: string, cheapestWrap: string | null) {
  const e = await prisma.estimate.findUniqueOrThrow({ where: { id: estimateId }, include: { project: true, lines: true } });
  const [rules, roofMs] = await Promise.all([
    prisma.rule.findMany(),
    prisma.measurement.findMany({ where: { projectId: e.projectId, key: "roof_total_sf" } }),
  ]);
  return evaluateRules(
    {
      projectId: e.projectId,
      market: e.project.market,
      scopes: parseScopes(e.project.scopes),
      isPublic: e.project.isPublic,
      isTaxExempt: e.project.isTaxExempt,
      form17Status: e.project.form17Status,
      lines: e.lines,
      takeoff: (e.takeoff as TakeoffConfig) ?? {},
      roofArea: {
        confirmed: roofMs.some((m) => m.status === "CONFIRMED" || m.status === "USER_ENTERED"),
        rejectedByRule01: roofMs.some((m) => m.confirmedBy === "ROOF-01"),
      },
      cheapestWrap,
    },
    rules,
  );
}
