import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { loadTakeoff } from "@/lib/takeoff/service";
import { TakeoffEditor } from "@/components/takeoff/editor";

export default async function TakeoffSheet({ params, searchParams }: { params: Promise<{ id: string; docId: string }>; searchParams: Promise<{ page?: string }> }) {
  const user = await requireUser();
  const { id, docId } = await params;
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const doc = await prisma.document.findFirst({ where: { id: docId, projectId: id } });
  if (!doc) notFound();
  const kind = /\.pdf$/i.test(doc.fileName) ? "pdf" : /\.(png|jpe?g|webp)$/i.test(doc.fileName) ? "image" : null;
  if (!kind) notFound();
  const [initial, settings, row] = await Promise.all([
    loadTakeoff(docId, page),
    getSettings(),
    prisma.planTakeoff.findUnique({ where: { documentId_page: { documentId: docId, page } }, select: { savedToJob: true } }),
  ]);
  return (
    <TakeoffEditor
      key={`${docId}-${page}`}
      documentId={docId}
      projectId={id}
      fileName={doc.fileName}
      fileUrl={`/api/documents/${docId}`}
      kind={kind}
      page={page}
      pageCount={doc.pages ?? 1}
      initial={initial}
      allowancePct={settings.takeoffAllowancePct ?? 1}
      canEdit={user.role === "ADMIN" || user.role === "ESTIMATOR"}
      savedToJob={row?.savedToJob ? row.savedToJob.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null}
    />
  );
}
