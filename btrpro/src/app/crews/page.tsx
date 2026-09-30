import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { crewsWithCompliance } from "@/lib/production/service";
import { CrewForm } from "@/components/production/forms";
import { ComplianceBadge } from "@/components/production/compliance-badge";
import { Collapsible } from "@/components/collapsible";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function Crews() {
  const user = await requireUser();
  const crews = await crewsWithCompliance();
  const alerts = crews.filter((c) => c.active && c.compliance.status !== "OK");
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Crews &amp; subs</h1>
        <p className="text-sm text-muted-foreground">Subs need a current certificate of insurance and workers&apos; comp on file before they&apos;re scheduled or sent work.</p>
      </div>
      {alerts.length > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
          Insurance needs attention: {alerts.map((c) => c.name).join(", ")}.
        </p>
      )}
      {user.role !== "VIEWER" && (
        <Collapsible title="Add a crew or sub" defaultOpen={crews.length === 0}>
          <CrewForm />
        </Collapsible>
      )}
      <Table>
        <THead>
          <TR>
            <TH>Name</TH>
            <TH>Type</TH>
            <TH>Contact</TH>
            <TH>Default pay</TH>
            <TH>Insurance</TH>
          </TR>
        </THead>
        <TBody>
          {crews.map((c) => (
            <TR key={c.id} className={c.active ? "" : "opacity-50"}>
              <TD>
                <Link href={`/crews/${c.id}`} className="font-medium hover:underline">
                  {c.name}
                </Link>
                {c.trade && <span className="block text-xs text-muted-foreground">{c.trade}</span>}
              </TD>
              <TD>{c.kind === "SUB" ? "Sub" : "Crew"}</TD>
              <TD className="text-sm">
                {c.leadName}
                {c.phone && <span className="block text-xs text-muted-foreground">{c.phone}</span>}
              </TD>
              <TD className="text-sm">
                {user.role === "VIEWER" || c.defaultRate == null ? "—" : c.payType === "HOURLY" ? `$${c.defaultRate}/h + ${c.burdenPct ?? "?"}%` : `$${c.defaultRate}/${c.rateUnit}`}
              </TD>
              <TD>
                <ComplianceBadge c={c.compliance} />
              </TD>
            </TR>
          ))}
          {crews.length === 0 && (
            <TR>
              <TD colSpan={5} className="text-muted-foreground">
                No crews yet.
              </TD>
            </TR>
          )}
        </TBody>
      </Table>
    </div>
  );
}
