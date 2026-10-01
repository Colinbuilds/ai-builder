import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listBuilders } from "@/lib/builders";
import { BuilderForm } from "@/components/builders/builder-form";
import { Collapsible } from "@/components/collapsible";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function Builders() {
  const user = await requireUser();
  const builders = await listBuilders();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Builders</h1>
        <p className="text-sm text-muted-foreground">Home builders with their own ABC pricing. A job whose client is a builder is priced from that builder&apos;s sheets, never from anyone else&apos;s.</p>
      </div>
      {user.role !== "VIEWER" && (
        <Collapsible title="Add a builder" defaultOpen={builders.length === 0}>
          <BuilderForm />
        </Collapsible>
      )}
      <Table>
        <THead>
          <TR>
            <TH>Builder</TH>
            <TH>Pricing</TH>
            <TH>If an item isn&apos;t on their sheet</TH>
            <TH className="text-right">Open jobs</TH>
          </TR>
        </THead>
        <TBody>
          {builders.map((b) => (
            <TR key={b.id}>
              <TD>
                <Link href={`/builders/${b.id}`} className="font-medium hover:underline">
                  {b.name}
                </Link>
                {b.abcAccount && <span className="block text-xs text-muted-foreground">ABC acct {b.abcAccount}</span>}
              </TD>
              <TD>
                {b.sheets.length === 0 ? (
                  <Badge variant="red">no pricing loaded</Badge>
                ) : (
                  b.sheets.map((s) => (
                    <span key={s.id} className="mr-2 inline-flex items-center gap-1 text-sm">
                      <span className="font-mono">{s.code}</span>
                      <span className="text-muted-foreground">({s._count.items})</span>
                      {s.date.status !== "CURRENT" && <Badge variant={s.date.status === "EXPIRED" ? "red" : "amber"}>{s.date.status.toLowerCase()}</Badge>}
                    </span>
                  ))
                )}
              </TD>
              <TD className="text-sm">{b.pricingFallback === "STANDARD" ? "BTR standard price, flagged" : b.pricingFallback === "MISSING" ? "MISSING" : <Badge variant="amber">not chosen</Badge>}</TD>
              <TD className="text-right tabular-nums">{b.openJobs}</TD>
            </TR>
          ))}
          {builders.length === 0 && (
            <TR>
              <TD colSpan={4} className="text-muted-foreground">
                No builders yet.
              </TD>
            </TR>
          )}
        </TBody>
      </Table>
    </div>
  );
}
