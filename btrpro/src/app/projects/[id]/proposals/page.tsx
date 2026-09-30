import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatUsd } from "@/lib/utils";

const statusVariant = (s: string) => (s === "SIGNED" ? "green" : s === "DECLINED" || s === "VOID" ? "red" : s === "VIEWED" ? "blue" : "outline");

export default async function ProposalsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(["ADMIN", "ESTIMATOR"]);
  const { id } = await params;
  const ps = await prisma.proposal.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" } });
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">Create a proposal from a finished estimate (Estimates tab → Customer proposal).</p>
      <Table>
        <THead>
          <TR>
            <TH>Proposal</TH>
            <TH className="text-right">Price</TH>
            <TH>Status</TH>
            <TH>Sent to</TH>
            <TH>Signed</TH>
          </TR>
        </THead>
        <TBody>
          {ps.map((p) => (
            <TR key={p.id}>
              <TD>
                <Link href={`/projects/${id}/proposals/${p.id}`} className="font-medium hover:underline">
                  {p.number}
                </Link>
              </TD>
              <TD className="text-right tabular-nums">{formatUsd(p.acceptedTotal ?? p.basePrice)}</TD>
              <TD>
                <Badge variant={statusVariant(p.status)}>{p.status.toLowerCase()}</Badge>
              </TD>
              <TD className="text-sm">{p.recipientEmail ?? "—"}</TD>
              <TD className="text-sm">{p.signedAt ? `${p.signerName}, ${p.signedAt.toLocaleDateString("en-US", { timeZone: "America/Chicago" })}` : "—"}</TD>
            </TR>
          ))}
          {ps.length === 0 && (
            <TR>
              <TD colSpan={5} className="py-6 text-center text-muted-foreground">
                No proposals yet.
              </TD>
            </TR>
          )}
        </TBody>
      </Table>
    </div>
  );
}
