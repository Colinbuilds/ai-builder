import Link from "next/link";
import type { Document, ExtractionRun } from "@prisma/client";
import { DocTypeSelect } from "@/components/docs/doc-type-select";
import { ExtractButton } from "@/components/docs/extract-button";
import { PlanReviewButton } from "@/components/docs/plan-review-button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export type DocRow = Document & { runs: ExtractionRun[]; jobEmail: { subject: string } | null };

export const FOLDERS = [
  "Email documents",
  "Measurement reports",
  "Plans & specs",
  "Job paperwork",
  "Receipts & invoices",
  "Delivery tickets",
  "Change orders",
  "Sub proposals",
  "Manufacturer data",
  "Photos",
] as const;
export type Folder = (typeof FOLDERS)[number];

/** Which folder a document shows in: by where it came from, its type, and (for app-filed files) its name. */
export function docFolder(d: Pick<Document, "type" | "source" | "jobEmailId" | "fileName">): Folder {
  if (d.source === "EMAIL" || d.jobEmailId) return "Email documents";
  if (d.type === "EAGLEVIEW") return "Measurement reports";
  if (d.type === "PLANS" || d.type === "SPECS") return "Plans & specs";
  if (d.type === "CHANGE_ORDER") return "Change orders";
  if (d.type === "SUB_PROPOSAL") return "Sub proposals";
  if (d.type === "MFR_DATA") return "Manufacturer data";
  if (/^delivery ticket/i.test(d.fileName)) return "Delivery tickets";
  if (/receipt|invoice/i.test(d.fileName)) return "Receipts & invoices";
  if (d.type === "PHOTO") return "Photos";
  return "Job paperwork";
}

const fileType = (d: DocRow) => (d.contentType === "application/pdf" || /\.pdf$/i.test(d.fileName) ? "PDF" : (d.fileName.split(".").pop() ?? "").toUpperCase().slice(0, 5) || "FILE");
const when = (d: Date) => d.toLocaleString("en-US", { timeZone: "America/Chicago", month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });

export function DocList({
  docs,
  users,
  projectId,
  canEdit,
  ai,
  view,
  q,
  folder,
}: {
  docs: DocRow[];
  users: Map<string, string>;
  projectId: string;
  canEdit: boolean;
  ai: boolean;
  view: "folders" | "list";
  q: string;
  folder: string;
}) {
  const needle = q.trim().toLowerCase();
  const shown = docs.filter((d) => (!needle || d.fileName.toLowerCase().includes(needle) || d.jobEmail?.subject.toLowerCase().includes(needle)) && (!folder || docFolder(d) === folder));
  const by = (d: DocRow) => (d.uploadedById ? (users.get(d.uploadedById) ?? "Staff") : d.source === "EMAIL" ? "Email" : d.source === "UPLOAD" ? "Crew / portal" : "External source");
  const table = (rows: DocRow[]) => (
    <Table>
      <THead>
        <TR>
          <TH>Document</TH>
          <TH>Type</TH>
          <TH className="hidden md:table-cell">File</TH>
          <TH className="hidden md:table-cell">Uploaded by</TH>
          <TH className="hidden lg:table-cell">Updated</TH>
          <TH>Read with BTRbot</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((d) => {
          const extractable = d.type === "EAGLEVIEW" || d.type === "PLANS" || d.type === "SPECS";
          const run = d.runs[0];
          return (
            <TR key={d.id}>
              <TD className="max-w-xs">
                <a href={`/api/documents/${d.id}`} target="_blank" className="font-medium break-words text-btr-link hover:underline">
                  {d.fileName}
                </a>
                {d.jobEmail && <span className="block text-xs text-muted-foreground">Email: {d.jobEmail.subject}</span>}
                {d.pages ? <span className="block text-xs text-muted-foreground">{d.pages} pages</span> : null}
              </TD>
              <TD>
                <DocTypeSelect id={d.id} type={d.type} disabled={!canEdit} />
              </TD>
              <TD className="hidden text-xs md:table-cell">{fileType(d)}</TD>
              <TD className="hidden text-xs md:table-cell">{by(d)}</TD>
              <TD className="hidden text-xs whitespace-nowrap tabular-nums lg:table-cell">{when(d.uploadedAt)}</TD>
              <TD className="max-w-sm">
                {extractable && canEdit ? (
                  d.type === "EAGLEVIEW" ? (
                    <ExtractButton id={d.id} label="Read measurements" disabled={!ai} />
                  ) : (
                    <PlanReviewButton id={d.id} projectId={projectId} pages={d.pages} disabled={!ai} />
                  )
                ) : (
                  <span className="text-xs text-muted-foreground">{extractable ? "" : "—"}</span>
                )}
                {run && <p className={`mt-1 text-xs ${run.status === "FAILED" ? "text-destructive" : "text-muted-foreground"}`}>{run.message}</p>}
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
  const base = `/projects/${projectId}/documents`;
  const link = (p: Record<string, string>) => `${base}?${new URLSearchParams({ view, ...(q ? { q } : {}), ...(folder ? { folder } : {}), ...p })}`;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Documents ({docs.length})</h2>
        <div className="flex overflow-hidden rounded-md border text-sm">
          {(["folders", "list"] as const).map((v) => (
            <Link key={v} href={link({ view: v })} className={`px-3 py-1 ${view === v ? "bg-btr-black text-white" : "hover:bg-muted"}`}>
              {v === "folders" ? "Folders" : "List"}
            </Link>
          ))}
        </div>
      </div>
      <form method="get" className="flex flex-wrap items-center gap-2 rounded-md bg-muted/60 p-2">
        <input type="hidden" name="view" value={view} />
        <input name="q" defaultValue={q} placeholder="Search file names and email subjects" className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm" />
        <select name="folder" defaultValue={folder} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">All folders</option>
          {FOLDERS.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <button className="h-9 rounded-md bg-btr-blue px-4 text-sm font-medium text-white">Filter</button>
        {(q || folder) && (
          <Link href={`${base}?view=${view}`} className="text-sm text-btr-link underline">
            Clear
          </Link>
        )}
      </form>
      {docs.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">No documents yet.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing matches.</p>
      ) : view === "list" ? (
        table(shown)
      ) : (
        FOLDERS.map((f) => {
          const rows = shown.filter((d) => docFolder(d) === f);
          if (!rows.length) return null;
          return (
            <details key={f} open className="rounded-md border border-btr-line">
              <summary className="cursor-pointer px-3 py-2 font-medium text-btr-link select-none">
                {f} ({rows.length})
              </summary>
              <div className="border-t">{table(rows)}</div>
            </details>
          );
        })
      )}
    </section>
  );
}
