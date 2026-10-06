"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadSheetAction } from "@/app/projects/takeoff-actions";

/**
 * Photos become JPEGs in the browser first: iPhone HEIC opens in Safari but not on the server or in other
 * browsers, and a 12-megapixel photo uploads much faster at plan-reading size (longest side 5000 px).
 */
async function toJpeg(file: File): Promise<File> {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const scale = Math.min(1, 5000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.92));
    if (!blob) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`, { type: "image/jpeg" });
  } catch {
    return file; // the server tries to convert it
  }
}

export function SheetUpload({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const send = async (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    setMsg(null);
    setBusy("Preparing…");
    const ready = await toJpeg(file);
    if (ready.size > 50 * 1024 * 1024) {
      setBusy(null);
      return setMsg("That file is over 50 MB. Split the plan set or export the sheet you need.");
    }
    setBusy("Uploading…");
    const f = new FormData();
    f.set("projectId", projectId);
    f.set("file", ready);
    try {
      const r = await uploadSheetAction(f);
      if (r.ok && r.docId) {
        setBusy("Opening…");
        router.push(`/projects/${projectId}/takeoff/${r.docId}`);
        return;
      }
      setMsg(r.message ?? "Upload failed.");
    } catch {
      setMsg("Upload failed — check your connection and try again.");
    }
    setBusy(null);
    if (pick.current) pick.current.value = "";
    if (cam.current) cam.current.value = "";
  };
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={!!busy} onClick={() => pick.current?.click()} className="rounded-md bg-btr-blue px-3 py-2 text-sm text-white hover:bg-btr-blue-dark disabled:opacity-60">
          {busy ?? "Upload a plan or photo"}
        </button>
        <button type="button" disabled={!!busy} onClick={() => cam.current?.click()} className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60">
          Take a photo
        </button>
        <span className="text-xs text-muted-foreground">PDF plan sets, sheet images, or a straight-on photo of a printed plan. It opens in the measure tool.</span>
      </div>
      <input ref={pick} type="file" accept="application/pdf,image/*,.heic,.heif" className="sr-only" onChange={(e) => send(e.currentTarget.files)} />
      <input ref={cam} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => send(e.currentTarget.files)} />
      {msg && <p className="text-sm text-red-700">{msg}</p>}
    </div>
  );
}
