import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveRuleAction } from "./actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { shortName } from "@/lib/company-profile";

export default async function RulesPage() {
  const user = await requireUser();
  const [rules, edits] = await Promise.all([
    prisma.rule.findMany({ orderBy: { id: "asc" } }),
    prisma.auditLog.findMany({ where: { entity: "Rule" }, include: { user: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const isAdmin = user.role === "ADMIN";
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Company rules</h1>
        <p className="text-sm text-muted-foreground">Checked on every estimate. Only an Admin can change them, and every change is logged. Locked rules are {shortName()} standards (CLAUDE.md §6).</p>
      </div>
      {rules.map((r) => (
        <form key={r.id} action={saveRuleAction} className="flex flex-col gap-2 rounded-md border p-3 text-sm">
          <input type="hidden" name="id" value={r.id} />
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold">{r.id}</span>
            <Badge variant="outline">{r.scope.replace(/_/g, " ")}</Badge>
            {r.locked && <Badge variant="amber">Locked standard</Badge>}
            {!r.active && <Badge variant="red">Off</Badge>}
          </div>
          {isAdmin ? (
            <>
              <textarea name="text" defaultValue={r.text} rows={2} className="rounded-md border border-input bg-background p-2" />
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1">
                  <input type="checkbox" name="active" defaultChecked={r.active} /> Active
                </label>
                <Button size="sm" variant="outline">
                  Save
                </Button>
              </div>
            </>
          ) : (
            <p>{r.text}</p>
          )}
          {(r.formula || r.itemNumber) && (
            <p className="text-xs text-muted-foreground">
              {r.formula && <>Formula: {r.formula}. </>}
              {r.itemNumber && <>Item: {r.itemNumber}.</>}
            </p>
          )}
        </form>
      ))}
      {edits.length > 0 && (
        <section className="text-sm">
          <h2 className="font-semibold">Recent changes</h2>
          <ul className="text-xs text-muted-foreground">
            {edits.map((e) => (
              <li key={e.id}>
                {e.createdAt.toLocaleString("en-US", { timeZone: "America/Chicago" })} · {e.user?.name} · {e.entityId}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
