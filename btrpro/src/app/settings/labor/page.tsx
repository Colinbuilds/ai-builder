import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LaborStandardForm } from "./form";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatUsd } from "@/lib/utils";

export default async function LaborStandardsPage() {
  const user = await requireUser(["ADMIN", "ESTIMATOR"]);
  void user;
  const standards = await prisma.laborStandard.findMany({ orderBy: [{ category: "asc" }, { task: "asc" }] });
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Labor standards</h1>
        <p className="text-sm text-muted-foreground">
          BTR&apos;s labor rates, entered once and reused on every estimate: piece rates ($ per SQ, LF, EA — how crews and subs are paid) or hourly production rates. Each
          rate needs a source (BTR price book, crew agreement, job history).
        </p>
      </div>
      <Table>
        <THead>
          <TR>
            <TH>Category</TH>
            <TH>Task</TH>
            <TH className="text-right">Rate</TH>
            <TH className="text-right">Crew</TH>
            <TH className="text-right">$/hr</TH>
            <TH className="text-right">Burden</TH>
            <TH>Source</TH>
          </TR>
        </THead>
        <TBody>
          {standards.map((s) => (
            <TR key={s.id}>
              <TD className="text-xs text-muted-foreground">{s.category ?? "—"}</TD>
              <TD className="font-medium">{s.task}</TD>
              <TD className="text-right whitespace-nowrap">
                {s.rateType === "UNIT" ? `${formatUsd(s.unitRate ?? 0)} / ${s.unit}` : `${s.productionRate} ${s.unit}/labor-hr`}
              </TD>
              <TD className="text-right">{s.crewSize ?? "—"}</TD>
              <TD className="text-right">{s.hourlyRate != null ? formatUsd(s.hourlyRate) : "—"}</TD>
              <TD className="text-right">{s.burdenPct != null ? `${s.burdenPct}%` : "—"}</TD>
              <TD className="text-xs text-muted-foreground">
                {s.source} · {s.enteredBy}
              </TD>
            </TR>
          ))}
          {standards.length === 0 && (
            <TR>
              <TD colSpan={7} className="py-6 text-center text-muted-foreground">
                No standards yet. Labor lines stay MISSING (or an approved placeholder) until rates are entered.
              </TD>
            </TR>
          )}
        </TBody>
      </Table>
      <LaborStandardForm />
    </div>
  );
}
