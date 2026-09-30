import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { diffEstimates } from "@/lib/estimates/service";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatUsd } from "@/lib/utils";

const f = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 }));
const m = (n: number | null | undefined) => (n == null ? "—" : formatUsd(n));

export default async function ComparePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ a?: string; b?: string }> }) {
  const user = await requireUser(["ADMIN", "ESTIMATOR"]);
  void user;
  const { id } = await params;
  const { a, b } = await searchParams;
  if (!a || !b) return <p className="text-sm">Pick two revisions to compare.</p>;
  const d = await diffEstimates(a, b);
  return (
    <div className="flex flex-col gap-4">
      <Link href={`/projects/${id}/estimates`} className="text-sm text-muted-foreground">
        ← Estimates
      </Link>
      <h2 className="text-xl font-semibold">
        {d.a.name} → {d.b.name}
      </h2>
      <p className="text-sm">
        Grand total {formatUsd(d.totals.a.grandTotal)} → <strong>{formatUsd(d.totals.b.grandTotal)}</strong> ({d.totals.b.grandTotal - d.totals.a.grandTotal >= 0 ? "+" : ""}
        {formatUsd(d.totals.b.grandTotal - d.totals.a.grandTotal)})
      </p>
      <Table>
        <THead>
          <TR>
            <TH>Line</TH>
            <TH>Change</TH>
            <TH className="text-right">Qty</TH>
            <TH className="text-right">Unit cost</TH>
            <TH className="text-right">Total</TH>
          </TR>
        </THead>
        <TBody>
          {d.lines.map((l) => (
            <TR key={l.key}>
              <TD>{l.name}</TD>
              <TD>
                <Badge variant={l.change === "added" ? "blue" : l.change === "removed" ? "red" : "amber"}>{l.change}</Badge>
              </TD>
              <TD className="text-right tabular-nums">
                {f(l.before?.qty)} → {f(l.after?.qty)}
              </TD>
              <TD className="text-right tabular-nums">
                {m(l.before?.cost)} → {m(l.after?.cost)}
              </TD>
              <TD className="text-right tabular-nums">
                {m(l.before?.total)} → {m(l.after?.total)}
              </TD>
            </TR>
          ))}
          {d.lines.length === 0 && (
            <TR>
              <TD colSpan={5} className="py-6 text-center text-muted-foreground">
                No line changes.
              </TD>
            </TR>
          )}
        </TBody>
      </Table>
    </div>
  );
}
