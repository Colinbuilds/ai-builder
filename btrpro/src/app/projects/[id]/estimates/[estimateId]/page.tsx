import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { priceScopeFor } from "@/lib/pricing-scope";
import {
  cheapestWrapOnSheet,
  measureMap,
  totalsFor,
  WASTE_REFERENCE,
  wasteSectionsFor,
  liveItems,
  type WasteMap,
} from "@/lib/estimates/service";
import { rulesForEstimate } from "@/lib/estimates/rules";
import {
  defaultConfig,
  MODULE_LABEL,
  MODULES_FOR_SCOPE,
  type Module,
  type TakeoffConfig,
} from "@/lib/estimates/takeoff";
import { sidingAreaUsed } from "@/lib/calc/siding";
import { READINESS_LABEL } from "@/lib/projects/readiness";
import { MEASUREMENT_BY_KEY } from "@/lib/docs/measurements";
import { TakeoffEditor } from "@/components/estimates/takeoff-editor";
import {
  ApplyTemplate,
  SaveAsTemplate,
} from "@/components/estimates/templates";
import { listTemplates } from "@/lib/estimates/templates";

const hashKey = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
};
import { Collapsible } from "@/components/collapsible";
import { CreateProposal } from "@/components/proposals/create-proposal";
import { getSettings } from "@/lib/settings";
import { WasteGate } from "@/components/estimates/waste-gate";
import { LineStatus } from "@/components/estimates/status";
import { LineActions } from "@/components/estimates/line-actions";
import { AddLine } from "@/components/estimates/add-line";
import { AddLabor } from "@/components/estimates/labor-form";
import { ReadinessBadge } from "@/components/projects/badges";
import {
  createRevisionAction,
  deleteLaborAction,
  openItemAction,
  runTakeoffAction,
  scopeItemAction,
  setContingencyAction,
} from "@/app/projects/estimate-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatUsd } from "@/lib/utils";

const SECTION_LABEL: Record<string, string> = {
  MATERIAL_ROOFING: "Materials — roofing",
  MATERIAL_DECK: "Materials — deck",
  MATERIAL_SIDING: "Materials — siding",
  GENERAL_CONDITIONS: "General conditions",
};
const fmtQty = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export default async function EstimatePage({
  params,
}: {
  params: Promise<{ id: string; estimateId: string }>;
}) {
  const user = await requireUser();
  const { id, estimateId } = await params;
  const e = await prisma.estimate.findUnique({
    where: { id: estimateId },
    include: {
      project: true,
      lines: {
        orderBy: [{ section: "asc" }, { sortOrder: "asc" }],
        include: {
          priceItem: {
            include: {
              sheet: { select: { code: true, warning: true, companyId: true } },
            },
          },
        },
      },
      laborLines: { orderBy: { sortOrder: "asc" } },
      openItems: { orderBy: { createdAt: "asc" } },
      scopeItems: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!e || e.projectId !== id) notFound();
  const canEdit = user.role !== "VIEWER";
  const locked = e.locked || !canEdit;
  const takeoff = (e.takeoff as TakeoffConfig) ?? {};
  const modules = MODULES_FOR_SCOPE[e.scopeType] as Module[];
  const waste = e.wastePctBySection as WasteMap;
  const scope = await priceScopeFor(id);
  const plank = takeoff.siding?.plank.itemNumber
    ? (await liveItems([takeoff.siding.plank.itemNumber], scope)).get(
        takeoff.siding.plank.itemNumber,
      )
    : null;
  const builderSheets = scope.builderId
    ? await prisma.priceSheet.count({
        where: { companyId: scope.builderId, isActive: true },
      })
    : 0;
  // lines priced from a builder's sheet that isn't this job's builder (the job's client changed after pricing)
  // or from BTR standard on what is now a builder job (and not as the builder's chosen fallback)
  const stale = e.lines.filter((l) => {
    const sheetOwner = l.priceItem?.sheet.companyId;
    if (!l.priceItem) return false;
    if (sheetOwner) return sheetOwner !== scope.builderId;
    return !!scope.builderId && !(l.note ?? "").includes("Not on ");
  }).length;
  const [totals, rules, mm, standards, measurements] = await Promise.all([
    totalsFor(estimateId),
    rulesForEstimate(
      estimateId,
      modules.includes("siding")
        ? await cheapestWrapOnSheet(
            plank?.sheetCode ?? takeoff.siding?.plank.sheetCode,
          )
        : null,
    ),
    measureMap(id),
    prisma.laborStandard.findMany({
      orderBy: [{ category: "asc" }, { task: "asc" }],
    }),
    prisma.measurement.findMany({ where: { projectId: id } }),
  ]);
  const siding = sidingAreaUsed(measurements);
  const quantities = [...mm.entries()].map(([k, v]) => ({
    label: MEASUREMENT_BY_KEY.get(k)?.label ?? k,
    value:
      k === "roof_total_sf" ? Math.round((v.value / 100) * 100) / 100 : v.value,
    unit:
      k === "roof_total_sf" ? "SQ" : (MEASUREMENT_BY_KEY.get(k)?.unit ?? ""),
    source: v.source,
  }));
  const sections = [
    "MATERIAL_ROOFING",
    "MATERIAL_DECK",
    "MATERIAL_SIDING",
    "GENERAL_CONDITIONS",
  ].filter((s) => e.lines.some((l) => l.section === s));
  const fails = rules.filter((r) => r.status === "fail");
  const templates = (
    await listTemplates({ companyId: e.project.clientCompanyId })
  ).map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    group: t.group,
    module: t.module,
    impactClass: t.impactClass,
  }));

  return (
    <div className="flex flex-col gap-6">
      {scope.builderId && (
        <p className="rounded-md border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
          Priced from <strong>{scope.builderName}</strong>&apos;s own ABC
          pricing.{" "}
          {builderSheets === 0 ? (
            <strong>No {scope.builderName} pricing is loaded yet, so </strong>
          ) : (
            "Items not on it: "
          )}
          {scope.fallback === "STANDARD"
            ? "BTR standard price, flagged on the line."
            : "MISSING."}
        </p>
      )}
      {stale > 0 && (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {stale} line{stale === 1 ? " was" : "s were"} priced under different
          pricing than this job uses now (the job&apos;s client changed). Re-run
          the takeoff and re-add those lines.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/projects/${id}/estimates`}
          className="text-sm text-muted-foreground"
        >
          ← Estimates
        </Link>
        <h2 className="text-xl font-semibold">
          {e.name} · {e.scopeType.replace("_", " ").toLowerCase()}
        </h2>
        {e.locked && <Badge variant="outline">Locked</Badge>}
        <ReadinessBadge readiness={e.project.readiness} />
        {canEdit && (
          <div className="flex flex-wrap gap-2 text-sm">
            <a
              className="underline"
              href={`/api/estimates/${e.id}/estimate.pdf`}
              target="_blank"
            >
              Estimate PDF
            </a>
            <a
              className="underline"
              href={`/api/estimates/${e.id}/takeoff.pdf`}
              target="_blank"
            >
              Takeoff PDF
            </a>
            <a className="underline" href={`/api/estimates/${e.id}/order.csv`}>
              Order CSV
            </a>
            <Link
              className="underline"
              href={`/projects/${id}/estimates/${e.id}/acculynx`}
            >
              AccuLynx copy
            </Link>
          </div>
        )}
        {canEdit && (
          <form action={createRevisionAction}>
            <input type="hidden" name="estimateId" value={e.id} />
            <Button size="sm" variant="outline">
              Create next revision
            </Button>
          </form>
        )}
      </div>

      {canEdit && (
        <section className="grid gap-2 rounded-md border p-4 sm:grid-cols-5">
          {(
            [
              ["Materials", totals.materials],
              ["General conditions", totals.generalConditions],
              ["Labor", totals.labor],
              [
                `Contingency${e.contingencyPct ? ` (${e.contingencyPct}%)` : ""}`,
                totals.contingency,
              ],
              ["Grand total", totals.grandTotal],
            ] as const
          ).map(([l, v]) => (
            <div key={l}>
              <div className="text-xs text-muted-foreground">{l}</div>
              <div className="text-lg font-semibold tabular-nums">
                {formatUsd(v)}
              </div>
            </div>
          ))}
          <div className="text-sm sm:col-span-5">
            {totals.incomplete ? (
              <Badge variant="red">
                INCOMPLETE — lines without a number are left out of these totals
              </Badge>
            ) : (
              <Badge variant="green">Every line has a number</Badge>
            )}{" "}
            <span className="text-muted-foreground">
              {READINESS_LABEL[e.project.readiness]}.
            </span>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">
          Company rules{" "}
          {fails.length ? (
            <Badge variant="red">{fails.length} failing</Badge>
          ) : (
            <Badge variant="green">all passing</Badge>
          )}
        </h3>
        <ul className="grid gap-1 text-sm md:grid-cols-2">
          {rules.map((r) => (
            <li key={r.id} className="flex items-start gap-2">
              <span
                className={
                  r.status === "pass"
                    ? "text-green-700 dark:text-green-400"
                    : r.status === "fail"
                      ? "text-destructive"
                      : "text-muted-foreground"
                }
              >
                {r.status === "pass" ? "✔" : r.status === "fail" ? "✖" : "ℹ"}
              </span>
              <span>
                <span className="font-mono text-xs">{r.id}</span> {r.message}
                {r.fix && !locked && r.fix.kind === "run_takeoff" && (
                  <form action={runTakeoffAction} className="inline">
                    <input type="hidden" name="estimateId" value={e.id} />
                    <input type="hidden" name="module" value={r.fix.module} />
                    <button className="ml-2 text-xs underline">
                      {r.fix.label}
                    </button>
                  </form>
                )}
                {r.fix?.kind === "link" && (
                  <Link href={r.fix.href} className="ml-2 text-xs underline">
                    {r.fix.label}
                  </Link>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section id="waste" className="flex flex-col gap-2">
        <h3 className="font-semibold">Waste</h3>
        <div className="grid gap-2 lg:grid-cols-2">
          {wasteSectionsFor(e.scopeType).map((s) => (
            <WasteGate
              key={s}
              estimateId={e.id}
              section={s}
              entry={
                waste[s] ?? { pct: null, approved: false, basis: "Not set" }
              }
              reference={WASTE_REFERENCE[s]}
              locked={locked}
            />
          ))}
        </div>
      </section>

      {!locked && modules.length > 0 && (
        <section className="flex flex-col gap-2 rounded-md border p-3">
          <ApplyTemplate
            estimateId={e.id}
            templates={templates.filter((t) =>
              modules.includes(t.module as Module),
            )}
          />
          <SaveAsTemplate
            estimateId={e.id}
            modules={modules}
            templates={templates}
            isAdmin={user.role === "ADMIN"}
          />
        </section>
      )}
      {modules.map((m) => (
        <Collapsible
          key={m}
          defaultOpen={!e.lines.some((l) => l.calcKey?.startsWith(`${m}:`))}
          className="rounded-md border p-4"
          title={`Takeoff — ${MODULE_LABEL[m]}`}
        >
          <div className="mt-3 flex flex-col gap-3">
            <MeasurementsUsed
              m={m}
              mm={mm}
              projectId={id}
              sidingFormula={m === "siding" ? siding.formula : null}
            />
            {/* keyed on the saved config so applying a template refreshes the editor */}
            <TakeoffEditor
              key={hashKey(JSON.stringify(takeoff[m] ?? null))}
              estimateId={e.id}
              module={m}
              initial={
                (takeoff[m] ?? defaultConfig(m, e.project.market)) as never
              }
              locked={locked}
            />
          </div>
        </Collapsible>
      ))}
      {e.scopeType === "PANELS" && (
        <p className="text-sm text-muted-foreground">
          Metal / wall panels: add panel, trim, girt, and fastener lines below
          from the sheets or supplier quotes.
        </p>
      )}

      {sections.map((s) => (
        <section key={s} className="flex flex-col gap-2">
          <h3 className="font-semibold">{SECTION_LABEL[s]}</h3>
          <Table>
            <THead>
              <TR>
                <TH>Item</TH>
                <TH>Supplier Material #</TH>
                <TH className="text-right">Quantity</TH>
                <TH>Unit</TH>
                {canEdit && <TH className="text-right">Unit Cost</TH>}
                {canEdit && <TH className="text-right">Total</TH>}
                <TH>Source/Status</TH>
                {!locked && <TH />}
              </TR>
            </THead>
            <TBody>
              {e.lines
                .filter((l) => l.section === s)
                .map((l) => (
                  <TR
                    key={l.id}
                    id={`line-${l.id}`}
                    className="align-top target:bg-amber-50 dark:target:bg-amber-950"
                  >
                    <TD className="max-w-md">
                      <details>
                        <summary className="cursor-pointer">
                          {l.itemName}
                          {l.ruleId && (
                            <span className="ml-1 font-mono text-xs text-muted-foreground">
                              {l.ruleId}
                            </span>
                          )}
                          {l.substitution && (
                            <Badge variant="amber" className="ml-1">
                              Substitution
                            </Badge>
                          )}
                        </summary>
                        <p className="mt-1 font-mono text-xs break-words text-muted-foreground">
                          {l.formula ?? "Entered by hand"}
                        </p>
                        {l.substitutionNote && (
                          <p className="text-xs text-amber-700 dark:text-amber-400">
                            {l.substitutionNote}
                          </p>
                        )}
                      </details>
                      {l.note && (
                        <p className="text-xs text-muted-foreground">
                          {l.note}
                        </p>
                      )}
                      {l.priceItem?.sheet.warning && (
                        <Badge variant="amber" className="mt-1">
                          Confirm account ({l.priceItem.sheet.code})
                        </Badge>
                      )}
                    </TD>
                    <TD className="font-mono text-xs">
                      {l.supplierItemNumber ??
                        (l.sourceStatus.startsWith("MISSING")
                          ? "MISSING"
                          : "—")}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {fmtQty(l.quantity)}
                    </TD>
                    <TD>{l.unit ?? "—"}</TD>
                    {canEdit && (
                      <TD className="text-right tabular-nums">
                        {l.sourceStatus === "CALL_FOR_PRICE"
                          ? "CALL"
                          : l.unitCost != null
                            ? formatUsd(l.unitCost)
                            : "—"}
                      </TD>
                    )}
                    {canEdit && (
                      <TD className="text-right tabular-nums">
                        {l.total != null ? formatUsd(l.total) : "—"}
                      </TD>
                    )}
                    <TD>
                      <LineStatus status={l.sourceStatus} />
                      {l.priceItem && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          {l.priceItem.sheet.code}
                        </span>
                      )}
                    </TD>
                    {!locked && (
                      <TD>
                        <LineActions
                          lineId={l.id}
                          quantity={l.quantity}
                          pendingAi={l.sourceStatus === "PENDING_AI"}
                        />
                      </TD>
                    )}
                  </TR>
                ))}
            </TBody>
          </Table>
        </section>
      ))}
      {!locked && (
        <AddLine
          estimateId={e.id}
          defaultSection={
            e.scopeType === "SIDING"
              ? "MATERIAL_SIDING"
              : e.scopeType === "DECK"
                ? "MATERIAL_DECK"
                : "MATERIAL_ROOFING"
          }
        />
      )}

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">Open items</h3>
        <ul className="flex flex-col gap-1 text-sm">
          {e.openItems.map((o) => (
            <li key={o.id} className="flex items-center gap-2">
              <form action={openItemAction}>
                <input type="hidden" name="id" value={o.id} />
                <input
                  type="hidden"
                  name="kind"
                  value={o.resolved ? "reopen" : "resolve"}
                />
                <button disabled={!canEdit} className="text-xs underline">
                  {o.resolved ? "☑" : "☐"}
                </button>
              </form>
              <span
                className={
                  o.resolved ? "text-muted-foreground line-through" : ""
                }
              >
                {o.text}
              </span>
              {o.owner && <Badge variant="outline">{o.owner}</Badge>}
            </li>
          ))}
          {e.openItems.length === 0 && (
            <li className="text-muted-foreground">None.</li>
          )}
        </ul>
        {canEdit && (
          <form action={openItemAction} className="flex gap-2">
            <input type="hidden" name="kind" value="add" />
            <input type="hidden" name="estimateId" value={e.id} />
            <Input
              name="text"
              placeholder="e.g. Confirm deck type with GC (RFI)"
              className="h-8 flex-1"
            />
            <Input name="owner" placeholder="Owner" className="h-8 w-32" />
            <Button size="sm" variant="outline">
              Add
            </Button>
          </form>
        )}
      </section>

      <section id="labor" className="flex flex-col gap-2">
        <h3 className="font-semibold">Labor</h3>
        {standards.length === 0 && (
          <p className="text-sm text-muted-foreground">
            The labor standards library is empty. Enter BTR&apos;s rates once
            under{" "}
            <Link href="/settings/labor" className="underline">
              Settings → Labor standards
            </Link>{" "}
            and they&apos;re reused on every estimate.
          </p>
        )}
        <Table>
          <THead>
            <TR>
              <TH>Task</TH>
              <TH className="text-right">Qty</TH>
              <TH className="text-right">Crew</TH>
              <TH className="text-right">Rate</TH>
              <TH className="text-right">Hours</TH>
              {canEdit && <TH className="text-right">$/hr</TH>}
              {canEdit && <TH className="text-right">Burden</TH>}
              {canEdit && <TH className="text-right">Total</TH>}
              <TH>Source/Status</TH>
              {!locked && <TH />}
            </TR>
          </THead>
          <TBody>
            {e.laborLines.map((l) => (
              <TR key={l.id} className="align-top">
                <TD>
                  {l.task}
                  {l.note && (
                    <p className="text-xs text-muted-foreground">{l.note}</p>
                  )}
                </TD>
                <TD className="text-right tabular-nums">
                  {fmtQty(l.quantity)} {l.quantityUnit}
                </TD>
                <TD className="text-right">{l.crewSize ?? "—"}</TD>
                <TD className="text-right">
                  {l.unitRate != null
                    ? canEdit
                      ? `${formatUsd(l.unitRate)}/${l.productionUnit ?? "unit"} piece rate`
                      : "piece rate"
                    : l.productionRate != null
                      ? `${l.productionRate} ${l.productionUnit ?? ""}/hr`
                      : "—"}
                </TD>
                <TD className="text-right tabular-nums">
                  {fmtQty(l.laborHours)}
                </TD>
                {canEdit && (
                  <TD className="text-right">
                    {l.hourlyRate != null ? formatUsd(l.hourlyRate) : "—"}
                  </TD>
                )}
                {canEdit && (
                  <TD className="text-right">
                    {l.burdenPct != null ? `${l.burdenPct}%` : "—"}
                  </TD>
                )}
                {canEdit && (
                  <TD className="text-right tabular-nums">
                    {l.total != null ? formatUsd(l.total) : "—"}
                  </TD>
                )}
                <TD>
                  <LineStatus status={l.sourceStatus} />
                </TD>
                {!locked && (
                  <TD>
                    <form action={deleteLaborAction}>
                      <input type="hidden" name="id" value={l.id} />
                      <button className="text-xs text-muted-foreground underline hover:text-destructive">
                        remove
                      </button>
                    </form>
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
        {!locked && (
          <AddLabor
            estimateId={e.id}
            standards={standards.map((s) => ({
              id: s.id,
              label:
                s.rateType === "UNIT"
                  ? `${s.category ? `${s.category}: ` : ""}${s.task} — $${s.unitRate}/${s.unit}`
                  : `${s.task} — ${s.productionRate} ${s.unit}/hr`,
            }))}
            quantities={quantities}
          />
        )}
      </section>

      {canEdit && (
        <form
          action={setContingencyAction}
          className="flex items-center gap-2 text-sm"
        >
          <input type="hidden" name="estimateId" value={e.id} />
          <span className="font-medium">Contingency</span>
          <Input
            name="contingencyPct"
            defaultValue={e.contingencyPct ?? ""}
            className="h-8 w-20"
            disabled={locked}
          />
          <span>%</span>
          {!locked && (
            <Button size="sm" variant="outline">
              Save
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            Recommended when the estimate rests on assumptions or placeholders.
          </span>
        </form>
      )}

      {canEdit && !totals.incomplete && (
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">Customer proposal</h3>
          <CreateProposal
            estimateId={e.id}
            defaultMarkup={(await getSettings()).markupPct}
            notReady={e.project.readiness === "NOT_READY"}
          />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">Scope</h3>
        <div className="grid gap-4 md:grid-cols-2">
          {(["WE_WILL", "WE_WILL_NOT"] as const).map((t) => (
            <div key={t} className="flex flex-col gap-1 text-sm">
              <span className="font-medium">
                {t === "WE_WILL" ? "We Will" : "We Will Not"}
              </span>
              <ul className="list-disc pl-5">
                {e.scopeItems
                  .filter((s) => s.type === t)
                  .map((s) => (
                    <li key={s.id}>
                      {s.text}{" "}
                      {!locked && (
                        <form action={scopeItemAction} className="inline">
                          <input type="hidden" name="estimateId" value={e.id} />
                          <input type="hidden" name="kind" value="delete" />
                          <input type="hidden" name="id" value={s.id} />
                          <button className="text-xs text-muted-foreground underline">
                            remove
                          </button>
                        </form>
                      )}
                    </li>
                  ))}
              </ul>
              {!locked && (
                <form action={scopeItemAction} className="flex gap-2">
                  <input type="hidden" name="estimateId" value={e.id} />
                  <input type="hidden" name="type" value={t} />
                  <Input
                    name="text"
                    className="h-8 flex-1"
                    placeholder={
                      t === "WE_WILL"
                        ? "Remove and dispose of existing shingles to the deck"
                        : "Replace rotted decking (priced per sheet if found)"
                    }
                  />
                  <Button size="sm" variant="outline">
                    Add
                  </Button>
                </form>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function MeasurementsUsed({
  m,
  mm,
  projectId,
  sidingFormula,
}: {
  m: Module;
  mm: Map<string, { value: number; source: string }>;
  projectId: string;
  sidingFormula: string | null;
}) {
  const keys: Record<Module, string[]> = {
    steep: [
      "roof_total_sf",
      "eaves_lf",
      "rakes_lf",
      "ridges_lf",
      "hips_lf",
      "valleys_lf",
      "drip_edge_lf",
      "step_flashing_lf",
      "penetrations_count",
    ],
    lowSlope: [
      "roof_total_sf",
      "perimeter_lf",
      "parapet_lf",
      "penetrations_count",
      "curbs_count",
      "drains_count",
    ],
    deck: ["roof_total_sf"],
    siding: [
      "siding_sf",
      "outside_corners_lf",
      "inside_corners_lf",
      "soffit_sf",
      "fascia_lf",
    ],
  };
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {keys[m].map((k) => {
        const v = mm.get(k);
        return (
          <span
            key={k}
            className={`rounded border px-2 py-1 ${v ? "" : "border-red-300 text-red-800 dark:border-red-800 dark:text-red-300"}`}
            title={v?.source}
          >
            {MEASUREMENT_BY_KEY.get(k)?.label}:{" "}
            {v
              ? `${v.value.toLocaleString("en-US")} ${MEASUREMENT_BY_KEY.get(k)?.unit}`
              : "MISSING"}
          </span>
        );
      })}
      <Link
        href={`/projects/${projectId}/documents`}
        className="px-2 py-1 underline"
      >
        Confirm measurements
      </Link>
      {sidingFormula && (
        <p className="w-full text-muted-foreground">{sidingFormula}</p>
      )}
    </div>
  );
}
