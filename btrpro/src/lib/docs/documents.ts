import { prisma } from "@/lib/db";
import { saveUpload } from "@/lib/storage";
import { pdfPages } from "@/lib/sheets/extract";
import { guessDocType } from "./classify";

export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const isPdf = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

export async function addDocument(opts: {
  projectId: string;
  bytes: Uint8Array;
  fileName: string;
  contentType?: string | null;
  source?: "UPLOAD" | "EMAIL" | "DRIVE" | "EAGLEVIEW";
  externalId?: string | null;
  userId?: string | null;
}) {
  if (!opts.bytes.length) throw new Error(`${opts.fileName} is empty.`);
  if (opts.bytes.length > MAX_DOCUMENT_BYTES) throw new Error(`${opts.fileName} is over 50 MB.`);
  if (opts.externalId) {
    const dup = await prisma.document.findFirst({ where: { projectId: opts.projectId, externalId: opts.externalId } });
    if (dup) return { doc: dup, duplicate: true };
  }
  let pages: string[] = [];
  if (isPdf(opts.bytes)) {
    try {
      pages = await pdfPages(opts.bytes);
    } catch {
      pages = []; // scanned or damaged PDF; Claude can still read it as a document
    }
  }
  const fileUrl = await saveUpload(opts.bytes, opts.fileName, `projects/${opts.projectId}/docs`);
  const doc = await prisma.document.create({
    data: {
      projectId: opts.projectId,
      type: guessDocType(opts.fileName, pages.slice(0, 3).join("\n"), opts.contentType),
      fileName: opts.fileName,
      fileUrl,
      pages: isPdf(opts.bytes) ? pages.length || null : null,
      extractedText: pages.length ? pages.join("\f") : null,
      source: opts.source ?? "UPLOAD",
      externalId: opts.externalId ?? null,
      contentType: opts.contentType ?? (isPdf(opts.bytes) ? "application/pdf" : null),
      sizeBytes: opts.bytes.length,
      uploadedById: opts.userId ?? null,
    },
  });
  await prisma.projectActivity.create({
    data: {
      projectId: opts.projectId,
      userId: opts.userId ?? null,
      kind: "document",
      text: `Added ${doc.type === "OTHER" ? "document" : doc.type.replace(/_/g, " ").toLowerCase()} "${doc.fileName}"${opts.source && opts.source !== "UPLOAD" ? ` from ${opts.source.toLowerCase()}` : ""}`,
    },
  });
  return { doc, duplicate: false };
}
