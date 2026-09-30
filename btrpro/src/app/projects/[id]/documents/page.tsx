import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { MEASUREMENT_BY_KEY, MEASUREMENTS } from "@/lib/docs/measurements";
import { INTAKE_BY_KEY, parseScopes } from "@/lib/projects/intake";
import { aiConfigured } from "@/lib/ai/claude";
import { getConnection, oauthConfigured } from "@/lib/integrations/oauth";
import { UploadDocs, DriveImport } from "@/components/docs/upload";
import { DocTypeSelect } from "@/components/docs/doc-type-select";
import { ExtractButton } from "@/components/docs/extract-button";
import { PlanReviewButton } from "@/components/docs/plan-review-button";
import { ConfirmationQueue, type QueueItem } from "@/components/docs/queue";
import { ManualMeasurement } from "@/components/docs/manual-measurement";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const fmtNum = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ connected?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { connected } = await searchParams;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) notFound();
  const canEdit = user.role !== "VIEWER";
  const [docs, measurements, facts] = await Promise.all([
    prisma.document.findMany({
      where: { projectId: id },
      include: {
        runs: { orderBy: { createdAt: "desc" }, take: 1 },
        jobEmail: { select: { subject: true } },
      },
      orderBy: { uploadedAt: "desc" },
    }),
    prisma.measurement.findMany({
      where: { projectId: id },
      include: { sourceDoc: { select: { fileName: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.extractedFact.findMany({
      where: { projectId: id, status: "PENDING" },
      include: { document: { select: { fileName: true } } },
    }),
  ]);
  const ai = aiConfigured();
  const driveReady = oauthConfigured("GOOGLE_DRIVE");
  const driveConn = driveReady
    ? await getConnection("GOOGLE_DRIVE", user.id)
    : null;
  const back = `/projects/${id}/documents`;

  const queue: QueueItem[] = [
    ...measurements
      .filter((m) => m.status === "EXTRACTED_PENDING")
      .map((m) => ({
        id: m.id,
        kind: "measurement" as const,
        label: MEASUREMENT_BY_KEY.get(m.key)?.label ?? m.key,
        value: String(m.value ?? ""),
        unit: m.unit,
        facet: m.facet,
        docId: m.sourceDocId,
        docName: m.sourceDoc?.fileName ?? null,
        page: m.sourcePage,
        quote: m.quote,
      })),
    ...facts.map((f) => ({
      id: f.id,
      kind: "fact" as const,
      label:
        f.key === "spec_section"
          ? "Spec section"
          : (INTAKE_BY_KEY.get(f.key)?.label ?? f.key),
      value: f.value,
      unit: null,
      facet: null,
      docId: f.documentId,
      docName: f.document.fileName,
      page: f.page,
      quote: f.quote,
    })),
  ];
  const usable = measurements.filter(
    (m) => m.status === "CONFIRMED" || m.status === "USER_ENTERED",
  );
  const rejected = measurements.filter((m) => m.status === "REJECTED");
  const rule01 = rejected.filter((m) => m.confirmedBy === "ROOF-01");
  const scopes = parseScopes(project.scopes);
  const siding = usable.filter((m) => m.key === "siding_sf");
  const masonry = usable.filter(
    (m) => m.key === "masonry_sf" || m.key === "masonry_corner_lf",
  );

  return (
    <div className="flex flex-col gap-6">
      {connected && (
        <p className="rounded-md border p-2 text-sm">
          {connected === "denied"
            ? "Connection cancelled."
            : `Connected: ${connected}`}
        </p>
      )}

      {canEdit && (
        <section className="grid gap-4 lg:grid-cols-2">
          <UploadDocs projectId={id} />
          <div className="flex flex-col gap-2 rounded-md border p-4 text-sm">
            <h2 className="font-semibold">Import from Google Drive</h2>
            {!driveReady ? (
              <p className="text-muted-foreground">
                Google Drive isn&apos;t configured on this server (Settings →
                Integrations).
              </p>
            ) : driveConn ? (
              <DriveImport projectId={id} />
            ) : (
              <Button
                asChild
                size="sm"
                variant="outline"
                className="self-start"
              >
                <a
                  href={`/api/integrations/google_drive/start?returnTo=${encodeURIComponent(back)}`}
                >
                  Connect Google Drive
                </a>
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              Paste a file or folder link; Google Docs/Sheets come in as PDFs.
              Files already on the job are skipped.
            </p>
          </div>
        </section>
      )}

      {rule01.map((m) => (
        <p
          key={m.id}
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {m.note}
        </p>
      ))}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Documents</h2>
        <Table>
          <THead>
            <TR>
              <TH>File</TH>
              <TH>Type</TH>
              <TH>Pages</TH>
              <TH>Came from</TH>
              <TH>Read with AI</TH>
            </TR>
          </THead>
          <TBody>
            {docs.map((d) => {
              const extractable =
                d.type === "EAGLEVIEW" ||
                d.type === "PLANS" ||
                d.type === "SPECS";
              const run = d.runs[0];
              return (
                <TR key={d.id}>
                  <TD className="max-w-xs">
                    <a
                      href={`/api/documents/${d.id}`}
                      target="_blank"
                      className="font-medium break-words hover:underline"
                    >
                      {d.fileName}
                    </a>
                  </TD>
                  <TD>
                    <DocTypeSelect
                      id={d.id}
                      type={d.type}
                      disabled={!canEdit}
                    />
                  </TD>
                  <TD className="tabular-nums">{d.pages ?? "—"}</TD>
                  <TD className="text-xs">
                    {d.source === "EMAIL" || d.jobEmail
                      ? `Email: ${d.jobEmail?.subject ?? ""}`
                      : d.source.toLowerCase()}
                  </TD>
                  <TD className="max-w-sm">
                    {extractable && canEdit ? (
                      d.type === "EAGLEVIEW" ? (
                        <ExtractButton
                          id={d.id}
                          label="Read measurements"
                          disabled={!ai}
                        />
                      ) : (
                        <PlanReviewButton
                          id={d.id}
                          projectId={id}
                          pages={d.pages}
                          disabled={!ai}
                        />
                      )
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {extractable ? "" : "—"}
                      </span>
                    )}
                    {run && (
                      <p
                        className={`mt-1 text-xs ${run.status === "FAILED" ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        {run.message}
                      </p>
                    )}
                  </TD>
                </TR>
              );
            })}
            {docs.length === 0 && (
              <TR>
                <TD
                  colSpan={5}
                  className="py-6 text-center text-muted-foreground"
                >
                  No documents yet.
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
        {!ai && (
          <p className="text-xs text-muted-foreground">
            AI reading is off: ANTHROPIC_API_KEY isn&apos;t set. Enter
            measurements by hand below.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">
          Waiting for confirmation ({queue.length})
        </h2>
        <p className="text-sm text-muted-foreground">
          Nothing read by AI is used until someone checks it against the page
          and confirms it.
        </p>
        <ConfirmationQueue items={queue} canEdit={canEdit} />
      </section>

      {scopes.includes("SIDING") && (
        <section className="rounded-md border p-4 text-sm">
          <h2 className="font-semibold">Siding area (SID-01, locked)</h2>
          <p className="mt-1">
            Siding takeoff uses the EagleView <strong>Siding</strong> wall area
            only, which already excludes windows and doors:{" "}
            <strong>
              {siding.length
                ? siding
                    .map(
                      (m) =>
                        `${fmtNum(m.value)} SF${m.facet ? ` (${m.facet})` : ""}`,
                    )
                    .join(" + ")
                : "MISSING"}
            </strong>
            .
          </p>
          <p className="mt-1 text-muted-foreground">
            Masonry area and masonry corners are never added to siding math
            {masonry.length
              ? `: ${masonry.map((m) => `${fmtNum(m.value)} ${m.unit}`).join(", ")} excluded.`
              : "."}{" "}
            Stone/stucco zone deductions are a GC boundary decision, not a
            default.
          </p>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Confirmed measurements</h2>
        <Table>
          <THead>
            <TR>
              <TH>Measurement</TH>
              <TH className="text-right">Value</TH>
              <TH>Status</TH>
              <TH>Source</TH>
            </TR>
          </THead>
          <TBody>
            {MEASUREMENTS.flatMap((def) =>
              usable
                .filter((m) => m.key === def.key)
                .map((m) => (
                  <TR key={m.id}>
                    <TD>
                      {def.label}
                      {m.facet && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {m.facet}
                        </span>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {fmtNum(m.value)} {m.unit}
                    </TD>
                    <TD>
                      <Badge variant="green">
                        {m.status === "USER_ENTERED" ? "Entered" : "Confirmed"}
                      </Badge>
                    </TD>
                    <TD className="text-xs text-muted-foreground">
                      {m.sourceDoc ? (
                        <a
                          href={`/api/documents/${m.sourceDocId}#page=${m.sourcePage ?? 1}`}
                          target="_blank"
                          className="underline"
                        >
                          {m.sourceDoc.fileName} p.{m.sourcePage}
                        </a>
                      ) : null}{" "}
                      {m.note} {m.confirmedBy && `· ${m.confirmedBy}`}
                    </TD>
                  </TR>
                )),
            )}
            {usable.length === 0 && (
              <TR>
                <TD
                  colSpan={4}
                  className="py-6 text-center text-muted-foreground"
                >
                  No confirmed measurements. Calculations stay MISSING until
                  there are.
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
        {canEdit && <ManualMeasurement projectId={id} />}
        {rejected.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              {rejected.length} rejected value(s)
            </summary>
            <ul className="mt-1 text-xs text-muted-foreground">
              {rejected.map((m) => (
                <li key={m.id}>
                  {MEASUREMENT_BY_KEY.get(m.key)?.label ?? m.key} ={" "}
                  {fmtNum(m.value)} {m.unit} — {m.note}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
