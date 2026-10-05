import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { liveItems } from "@/lib/estimates/service";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  listTemplates,
  templateItemNumbers,
} from "@/lib/estimates/templates";
import { TemplateMetaForm, UseOnJob } from "@/components/estimates/templates";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Collapsible } from "@/components/collapsible";
import { shortName } from "@/lib/company-profile";

const SLOT: Record<string, string> = {
  shingle: "Shingles",
  starter: "Starter",
  hipRidge: "Hip & ridge",
  ridgeVent: "Ridge vent",
  underlayment: "Underlayment",
  iceWater: "Ice & water",
  dripEdge: "Drip edge",
  stepFlashing: "Step flashing",
  pipeBoot: "Pipe boots",
  membrane: "Membrane",
  coverBoard: "Cover board",
  fastener: "Fasteners",
  plate: "Plates",
  seamTape: "Seam tape",
  primer: "Primer",
  adhesive: "Adhesive",
  terminationBar: "Termination bar",
  edgeMetal: "Edge metal",
  plank: "Siding",
  soffit: "Soffit",
};

type Slot = { label: string; itemNumber: string | null };
/** Flattens a template config into labeled product slots for display. */
function slots(config: Record<string, unknown>): Slot[] {
  const out: Slot[] = [];
  for (const [k, v] of Object.entries(config)) {
    if (Array.isArray(v)) {
      for (const x of v)
        if (x && typeof x === "object" && "itemNumber" in x)
          out.push({
            label:
              (x as { label?: string; layer?: string }).label ??
              (k === "insulation"
                ? `Insulation (layer ${(x as { layer?: string }).layer})`
                : k),
            itemNumber: (x as { itemNumber: string | null }).itemNumber,
          });
    } else if (v && typeof v === "object") {
      if ("itemNumber" in v)
        out.push({
          label: SLOT[k] ?? k,
          itemNumber: (v as { itemNumber: string | null }).itemNumber,
        });
      if (k === "houseWrap")
        out.push({
          label: "House wrap",
          itemNumber:
            (v as { mode: string }).mode === "cheapest"
              ? "cheapest on the sheet (SID-04)"
              : ((v as { pick: { itemNumber: string | null } }).pick
                  .itemNumber ?? null),
        });
      if (k === "preSecurement") {
        const ps = v as {
          fastener: { itemNumber: string | null };
          plate: { itemNumber: string | null };
        };
        if (ps.fastener.itemNumber || ps.plate.itemNumber)
          out.push(
            {
              label: "Pre-securement fastener",
              itemNumber: ps.fastener.itemNumber,
            },
            { label: "Pre-securement plate", itemNumber: ps.plate.itemNumber },
          );
      }
    }
  }
  return out;
}

export default async function Templates() {
  const user = await requireUser();
  const templates = await listTemplates({
    includeInactive: user.role === "ADMIN",
  });
  const items = await liveItems(
    templates.flatMap((t) => templateItemNumbers(t.config)),
  );
  const jobs =
    user.role === "VIEWER"
      ? []
      : await prisma.project.findMany({
          where: {
            status: {
              in: ["LEAD", "ESTIMATING", "SUBMITTED", "SOLD", "SCHEDULED"],
            },
          },
          select: { id: true, name: true },
          orderBy: { updatedAt: "desc" },
          take: 200,
        });
  const byCat = CATEGORY_ORDER.map(
    (c) => [c, templates.filter((t) => t.category === c)] as const,
  ).filter(([, ts]) => ts.length);
  const usd = (n: number | null, call: boolean) =>
    call || n == null ? "CALL" : `$${n.toFixed(2)}`;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Estimate templates</h1>
        <p className="text-sm text-muted-foreground">
          Product systems for each brand and line. To use one: open a job →
          Estimates tab → “Start from a template”, or click “Use on a job” on
          any template below. On an estimate that's already started, use
          “Product system → Apply”. Quantities still come from the job&apos;s
          confirmed measurements, and prices from the live sheets — or the
          builder&apos;s pricing on builder jobs. Class 4 is shown only where
          the price sheet itself says IR, Impact, or Class 4; everything else
          says so until you confirm the rating with a source.
        </p>
        <p className="mt-1 text-sm">
          To make your own: set up the products on any estimate, then use
          &quot;Save these product picks as a template&quot;.
        </p>
      </div>
      {byCat.map(([cat, ts]) => {
        const groups = [...new Set(ts.map((t) => t.group))];
        return (
          <section key={cat} className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">
              {CATEGORY_LABEL[cat] ?? cat}
            </h2>
            {groups.map((g) => (
              <div key={g} className="flex flex-col gap-2">
                <h3 className="text-sm font-medium text-muted-foreground">
                  {g}
                </h3>
                <div className="grid gap-2 lg:grid-cols-2">
                  {ts
                    .filter((t) => t.group === g)
                    .map((t) => {
                      const ss = slots(t.config as Record<string, unknown>);
                      const missing = ss.filter((s) => !s.itemNumber).length;
                      return (
                        <div
                          key={t.id}
                          className={`rounded-md border p-3 ${t.active ? "" : "opacity-50"}`}
                        >
                          <Collapsible
                            title={
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">{t.name}</span>
                                {t.impactClass === "CLASS_4" && (
                                  <Badge variant="blue">Class 4</Badge>
                                )}
                                {t.impactClass === "CLASS_3" && (
                                  <Badge variant="outline">Class 3</Badge>
                                )}
                                {!t.impactClass && t.category === "SHINGLE" && (
                                  <Badge variant="amber">
                                    rating not on sheet
                                  </Badge>
                                )}
                                {missing > 0 && (
                                  <Badge variant="outline">
                                    {missing} slot{missing === 1 ? "" : "s"} to
                                    pick
                                  </Badge>
                                )}
                                {!t.active && <Badge>inactive</Badge>}
                              </span>
                            }
                          >
                            <table className="mt-2 w-full text-xs">
                              <tbody>
                                {ss.map((s, i) => {
                                  const it = s.itemNumber
                                    ? items.get(s.itemNumber)
                                    : undefined;
                                  return (
                                    <tr key={i} className="border-t">
                                      <td className="py-1 pr-2 text-muted-foreground">
                                        {s.label}
                                      </td>
                                      <td className="py-1 pr-2">
                                        {it ? (
                                          <>
                                            <span className="font-mono">
                                              {it.itemNumber}
                                            </span>{" "}
                                            {it.description}
                                          </>
                                        ) : s.itemNumber ? (
                                          <span
                                            className={
                                              s.itemNumber.includes(" ")
                                                ? ""
                                                : "text-red-700"
                                            }
                                          >
                                            {s.itemNumber}
                                            {s.itemNumber.includes(" ")
                                              ? ""
                                              : " — not on a loaded sheet"}
                                          </span>
                                        ) : (
                                          <span className="text-amber-700">
                                            not picked
                                          </span>
                                        )}
                                      </td>
                                      <td className="py-1 text-right whitespace-nowrap tabular-nums">
                                        {it
                                          ? `${usd(it.unitPrice, it.priceStatus === "CALL")}/${it.uom}`
                                          : ""}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            {t.impactSource && (
                              <p className="mt-2 text-xs text-muted-foreground">
                                Rating source: {t.impactSource}
                              </p>
                            )}
                            {t.notes && (
                              <p className="mt-1 text-xs">{t.notes}</p>
                            )}
                            {t.active && (
                              <div className="mt-2">
                                <UseOnJob templateId={t.id} jobs={jobs} />
                              </div>
                            )}
                            {user.role === "ADMIN" && (
                              <div className="mt-2">
                                <TemplateMetaForm t={t} />
                              </div>
                            )}
                          </Collapsible>
                        </div>
                      );
                    })}
                </div>
              </div>
            ))}
          </section>
        );
      })}
      <p className="text-xs text-muted-foreground">
        Prices shown are {shortName()} standard.{" "}
        <Link href="/builders" className="underline">
          Builder jobs
        </Link>{" "}
        price the same items from the builder&apos;s own sheets.
      </p>
    </div>
  );
}
