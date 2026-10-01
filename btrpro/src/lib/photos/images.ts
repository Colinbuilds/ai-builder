// Job/receipt photos: check the bytes are really an image, and make smaller copies for thumbnails and the AI.
import sharp from "sharp";
import { sniff } from "@/lib/portal/crew";

export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
export const IMAGE_TYPE = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" } as const;

/** Image kind from the file's bytes, or null (the name and type a phone sends can't be trusted). */
export function imageKind(b: Uint8Array) {
  const k = sniff(b);
  return k && k !== "pdf" ? k : null;
}

/** A JPEG no wider/taller than `max` px, turned upright from the camera's EXIF. Returns null when it can't be decoded. */
export async function resized(bytes: Uint8Array, max: number, quality = 80): Promise<Buffer | null> {
  try {
    return await sharp(bytes, { failOn: "none" }).rotate().resize({ width: max, height: max, fit: "inside", withoutEnlargement: true }).jpeg({ quality }).toBuffer();
  } catch {
    return null;
  }
}
