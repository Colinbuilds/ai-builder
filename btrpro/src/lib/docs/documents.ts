import { prisma } from "@/lib/db";
import { saveUpload } from "@/lib/storage";
import { pdfPages } from "@/lib/sheets/extract";
import { guessDocType } from "./classify";
import { IMAGE_TYPE, imageKind } from "@/lib/photos/images";
import sharp from "sharp";

/**
 * Phone photos arrive as HEIC, WebP or with no file extension ("image", "IMG_1234.HEIC"). Browsers can't show
 * HEIC, so it becomes a JPEG when the server can decode it, and every image gets the extension its bytes say.
 */
export async function normalizePhoto(bytes: Uint8Array, fileName: string, contentType: string | null) {
  const kind = imageKind(bytes);
  if (!kind) return { bytes, fileName, contentType };
  const base = fileName.replace(/\.[^.\/]{1,5}$/, "") || "photo";
  if (kind === "heic") {
    try {
      const jpeg = await sharp(bytes, { failOn: "none" }).rotate().jpeg({ quality: 92 }).toBuffer();
      return { bytes: new Uint8Array(jpeg), fileName: `${base}.jpg`, contentType: "image/jpeg" };
    } catch {
      return { bytes, fileName: `${base}.heic`, contentType: IMAGE_TYPE.heic };
    }
  }
  const ext = kind === "jpg" ? /\.jpe?g$/i.test(fileName) ? fileName.split(".").pop()! : "jpg" : kind;
  return { bytes, fileName: new RegExp(`\\.${ext}$`, "i").test(fileName) ? fileName : `${base}.${ext}`, contentType: IMAGE_TYPE[kind] };
}

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
  opts = { ...opts, ...(await normalizePhoto(opts.bytes, opts.fileName, opts.contentType ?? null)) };
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
