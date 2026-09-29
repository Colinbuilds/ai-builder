import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// File storage. STORAGE_DRIVER=local writes under UPLOAD_DIR (default ./uploads) — dev only, since
// serverless hosts don't keep local files. STORAGE_DRIVER=s3 uses any S3-compatible bucket
// (AWS S3, Cloudflare R2, Backblaze B2) via S3_ENDPOINT / S3_REGION / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY.
const root = () => path.resolve(process.env.UPLOAD_DIR ?? "uploads");
const driver = () => process.env.STORAGE_DRIVER ?? "local";

let s3: S3Client | null = null;
const s3Client = () =>
  (s3 ??= new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" },
  }));

export async function saveUpload(bytes: Uint8Array, fileName: string, folder: string): Promise<string> {
  const safe = fileName.replace(/[^\w.\- ]+/g, "_").slice(-120);
  const rel = path.posix.join(folder, `${randomUUID()}-${safe}`);
  if (driver() === "s3") {
    if (!process.env.S3_BUCKET) throw new Error("S3_BUCKET is not set.");
    await s3Client().send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: rel, Body: bytes }));
    return `s3:${rel}`;
  }
  if (driver() !== "local") throw new Error(`Unknown STORAGE_DRIVER "${driver()}".`);
  const abs = path.join(root(), rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, bytes);
  return `local:${rel}`;
}

export async function readUpload(fileUrl: string): Promise<Buffer> {
  if (fileUrl.startsWith("s3:")) {
    const res = await s3Client().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: fileUrl.slice(3) }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  if (!fileUrl.startsWith("local:")) throw new Error("Unsupported file location");
  const abs = path.join(root(), fileUrl.slice("local:".length));
  if (!abs.startsWith(root() + path.sep)) throw new Error("Invalid file path");
  return readFile(abs);
}
