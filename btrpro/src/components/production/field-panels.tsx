import { addPunchAction, priceTagAction, punchDoneAction, readyCheckAction, resolveIssueAction } from "@/app/projects/field-actions";
import { tagSummary, type ReadyItem } from "@/lib/production/field";

const mark = (ok: boolean | null) => (ok ? "✓" : "!");
const tone = (ok: boolean | null) => (ok ? "text-green-700" : "text-amber-700");

export function ReadyPanel({ projectId, items, canEdit }: { projectId: string; items: ReadyItem[]; canEdit: boolean }) {
  const open = items.filter((i) => !i.ok).length;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">
        Ready to schedule{" "}
        <span className={`text-sm font-normal ${open ? "text-amber-700" : "text-green-700"}`}>
          {open ? `${open} to check — warnings only, you can still schedule` : "all set"}
        </span>
      </h2>
      <ul className="grid gap-1 text-sm sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.key} className="flex items-start gap-2">
            {i.manual && canEdit ? (
              <form action={readyCheckAction}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="key" value={i.key} />
                <input type="hidden" name="on" value={i.ok ? "0" : "1"} />
                <button aria-label={`${i.ok ? "Uncheck" : "Check"} ${i.label}`} className={`h-5 w-5 rounded border text-xs ${i.ok ? "border-green-600 bg-green-600 text-white" : "border-input"}`}>
                  {i.ok ? "✓" : ""}
                </button>
              </form>
            ) : (
              <span className={`w-5 text-center font-bold ${tone(i.ok)}`}>{mark(i.ok)}</span>
            )}
            <span>
              {i.label}
              {i.detail && <span className="block text-xs text-muted-foreground">{i.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Punch = { id: string; text: string; createdBy: string; doneAt: Date | null; doneBy: string | null; crewName?: string | null };

export function PunchPanel({ projectId, items, crews, canEdit }: { projectId: string; items: Punch[]; crews: { id: string; name: string }[]; canEdit: boolean }) {
  const open = items.filter((i) => !i.doneAt);
  return (
    <section id="punch" className="flex flex-col gap-2">
      <h2 className="font-semibold">
        Punch list{" "}
        <span className="text-sm font-normal text-muted-foreground">
          {open.length ? `${open.length} open — crew pay waits until it's cleared` : items.length ? "all cleared" : ""}
        </span>
      </h2>
      {items.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {items.map((i) => (
            <li key={i.id} className="flex items-start gap-2">
              {canEdit ? (
                <form action={punchDoneAction}>
                  <input type="hidden" name="id" value={i.id} />
                  <input type="hidden" name="done" value={i.doneAt ? "0" : "1"} />
                  <button aria-label={`${i.doneAt ? "Reopen" : "Clear"} ${i.text}`} className={`h-5 w-5 rounded border text-xs ${i.doneAt ? "border-green-600 bg-green-600 text-white" : "border-input"}`}>
                    {i.doneAt ? "✓" : ""}
                  </button>
                </form>
              ) : (
                <span className="w-5">{i.doneAt ? "✓" : "○"}</span>
              )}
              <span className={i.doneAt ? "text-muted-foreground line-through" : ""}>
                {i.text}
                <span className="block text-xs text-muted-foreground no-underline">
                  {i.crewName ? `${i.crewName} · ` : ""}added by {i.createdBy}
                  {i.doneBy && ` · cleared by ${i.doneBy}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form action={addPunchAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          <input name="text" required placeholder="What needs fixing (e.g. reseal pipe boot, back slope)" className="h-9 min-w-[16rem] flex-1 rounded-md border border-input bg-background px-2 text-sm" />
          <select name="crewId" className="h-9 rounded-md border border-input bg-background px-2 text-sm" defaultValue="">
            <option value="">Any crew</option>
            {crews.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="h-9 rounded-md border px-3 text-sm hover:bg-muted">Add</button>
        </form>
      )}
    </section>
  );
}

type Issue = {
  id: string;
  note: string;
  reportedBy: string;
  createdAt: Date;
  status: string;
  resolution: string | null;
  resolvedBy: string | null;
  photos: { url: string }[];
  kind: string | null;
  workDate: Date | null;
  men: number | null;
  hours: number | null;
  materials: string | null;
  directedBy: string | null;
  signerName: string | null;
  signatureImage: string | null;
  signedAt: Date | null;
  changeOrderId: string | null;
};

export function IssuesPanel({ projectId, issues, canEdit, canPrice }: { projectId: string; issues: Issue[]; canEdit: boolean; canPrice: boolean }) {
  if (!issues.length) return null;
  return (
    <section id="issues" className="flex flex-col gap-2">
      <h2 className="font-semibold">Found on site &amp; extra work tags</h2>
      {issues.map((i) => {
        const extra = i.kind === "EXTRA";
        const days = Math.floor((Date.now() - (i.workDate ?? i.createdAt).getTime()) / 86_400_000);
        return (
          <div key={i.id} className={`flex flex-col gap-2 rounded-md border p-3 text-sm ${i.status === "OPEN" ? (days > 7 ? "border-red-400" : "border-amber-400") : ""}`}>
            <div>
              <span className={`mr-1 rounded px-1 text-xs font-medium ${extra ? "bg-btr-blue-soft" : "bg-muted"}`}>{extra ? "Extra work tag" : "Found on site"}</span>
              <b>{i.reportedBy}</b> · {(i.workDate ?? i.createdAt).toISOString().slice(0, 10)} ·{" "}
              <span className={i.status === "OPEN" ? (days > 7 ? "font-medium text-red-700" : "text-amber-700") : "text-muted-foreground"}>
                {i.status === "OPEN" ? `needs pricing · ${days} day${days === 1 ? "" : "s"} old` : i.status === "PRICED" ? "priced" : "no charge"}
              </span>
              <p className="mt-1">{i.note}</p>
              {(i.men || i.hours || i.materials || i.directedBy) && (
                <p className="text-xs text-muted-foreground">
                  {[i.men && `${i.men} workers`, i.hours && `${i.hours} man-hours`, i.materials && `materials: ${i.materials}`, i.directedBy && `directed by ${i.directedBy}`].filter(Boolean).join(" · ")}
                </p>
              )}
              {i.resolution && (
                <p className="text-xs text-muted-foreground">
                  {i.resolvedBy}: {i.resolution}{" "}
                  {i.changeOrderId && (
                    <a href={`/projects/${projectId}/costs#change-orders`} className="text-btr-link hover:underline">
                      open change order
                    </a>
                  )}
                </p>
              )}
            </div>
            {(i.photos.length > 0 || i.signatureImage) && (
              <div className="flex flex-wrap items-end gap-2">
                {i.photos.map((_, n) => (
                  <a key={n} href={`/api/crew/issue/${i.id}/${n}`} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/crew/issue/${i.id}/${n}?w=300`} alt="Field photo" className="h-24 w-24 rounded object-cover" />
                  </a>
                ))}
                {i.signatureImage && (
                  <figure className="rounded border bg-white p-1 text-[11px] text-black">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={i.signatureImage} alt={`Signature of ${i.signerName}`} className="h-16" />
                    <figcaption>
                      Signed by {i.signerName} · {i.signedAt?.toISOString().slice(0, 16).replace("T", " ")} UTC
                    </figcaption>
                  </figure>
                )}
              </div>
            )}
            {i.status === "OPEN" && canEdit && (
              <div className="flex flex-col gap-2">
                {canPrice && (
                  <form action={priceTagAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={i.id} />
                    <input name="description" defaultValue={tagSummary(i)} className="h-8 min-w-[16rem] flex-1 rounded-md border border-input bg-background px-2" />
                    <input name="amount" required inputMode="decimal" placeholder="Price $" className="h-8 w-28 rounded-md border border-input bg-background px-2" />
                    <input name="costImpact" inputMode="decimal" placeholder="Our cost $" className="h-8 w-28 rounded-md border border-input bg-background px-2" />
                    <button className="h-8 rounded-md bg-btr-blue px-3 text-white hover:bg-btr-blue-dark">Make change order</button>
                  </form>
                )}
                <form action={resolveIssueAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={i.id} />
                  <input name="resolution" placeholder="Note (optional)" className="h-8 rounded-md border border-input bg-background px-2" />
                  <button name="status" value="PRICED" className="h-8 rounded-md border px-2 hover:bg-muted">
                    Already priced elsewhere
                  </button>
                  <button name="status" value="NO_CHARGE" className="h-8 rounded-md border px-2 hover:bg-muted">
                    No charge
                  </button>
                </form>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
