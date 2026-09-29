import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// File storage. "local" writes under ./uploads; S3-compatible storage is added with document upload (Phase 5).
const root = () => path.resolve(process.env.UPLOAD_DIR ?? "uploads");

export async function saveUpload(bytes: Uint8Array, fileName: string, folder: string): Promise<string> {
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver !== "local") throw new Error(`STORAGE_DRIVER=${driver} is not available yet; use "local".`);
  const safe = fileName.replace(/[^\w.\- ]+/g, "_").slice(-120);
  const rel = path.posix.join(folder, `${randomUUID()}-${safe}`);
  const abs = path.join(root(), rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, bytes);
  return `local:${rel}`;
}

export async function readUpload(fileUrl: string): Promise<Buffer> {
  if (!fileUrl.startsWith("local:")) throw new Error("Unsupported file location");
  const abs = path.join(root(), fileUrl.slice("local:".length));
  if (!abs.startsWith(root() + path.sep)) throw new Error("Invalid file path");
  return readFile(abs);
}
