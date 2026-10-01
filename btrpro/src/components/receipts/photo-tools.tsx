"use client";

import { useEffect, useRef, useState } from "react";
import { Crop as CropIcon, Minus, Plus, RotateCcw, RotateCw, X } from "lucide-react";
import { useFormAction } from "@/components/use-form-action";
import { recropAction } from "@/app/receipts/actions";
import { Problems } from "@/components/projects/problems";
import { Button } from "@/components/ui/button";

type Crop = { x: number; y: number; w: number; h: number };
type Page = { index: number; pdf: boolean; crop: Crop | null; manual: boolean; rotate: number };

/** The receipt pages: cleaned-up view with tap-to-zoom, and a crop/rotate tool that re-reads the page. */
export function ReceiptPhotos({ rid, pages, version, canEdit }: { rid: string; pages: Page[]; version: string; canEdit: boolean }) {
  const [zoom, setZoom] = useState<number | null>(null);
  const [cropping, setCropping] = useState<number | null>(null);
  const src = (i: number, v: "clean" | "orig") => `/api/receipts/${rid}/${i}${v === "clean" ? `?v=clean&t=${version}` : ""}`;
  return (
    <section className="flex flex-col gap-3">
      {pages.map((p) =>
        p.pdf ? (
          <a key={p.index} href={src(p.index, "orig")} target="_blank" className="text-sm text-btr-link underline">
            Open PDF page {p.index + 1}
          </a>
        ) : (
          <figure key={p.index} className="flex flex-col gap-1">
            <button type="button" onClick={() => setZoom(p.index)} className="block cursor-zoom-in" aria-label={`Zoom into page ${p.index + 1}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src(p.index, "clean")} alt={`Receipt page ${p.index + 1}, cleaned up`} className="w-full rounded-md border border-btr-line" />
            </button>
            <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{p.manual ? "Your crop" : p.crop ? "Auto-cropped to the paper" : "Whole photo"} · tap to zoom</span>
              {canEdit && (
                <button type="button" onClick={() => setCropping(p.index)} className="flex items-center gap-1 text-btr-link hover:underline">
                  <CropIcon size={13} /> Crop / rotate
                </button>
              )}
            </figcaption>
          </figure>
        ),
      )}
      {zoom != null && <ZoomViewer clean={src(zoom, "clean")} original={src(zoom, "orig")} onClose={() => setZoom(null)} />}
      {cropping != null && <CropTool rid={rid} page={pages.find((p) => p.index === cropping)!} onClose={() => setCropping(null)} />}
    </section>
  );
}

function ZoomViewer({ clean, original, onClose }: { clean: string; original: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [which, setWhich] = useState<"clean" | "orig">("clean");
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 text-white" role="dialog" aria-label="Receipt zoom">
      <div className="flex flex-wrap items-center gap-2 p-2">
        <div className="flex overflow-hidden rounded-md border border-white/30 text-sm">
          {(["clean", "orig"] as const).map((w) => (
            <button key={w} type="button" onClick={() => setWhich(w)} className={`px-3 py-1 ${which === w ? "bg-white text-black" : ""}`}>
              {w === "clean" ? "Cleaned up" : "Original"}
            </button>
          ))}
        </div>
        <button type="button" aria-label="Zoom out" onClick={() => setScale((s) => Math.max(1, s - 0.5))} className="rounded-md border border-white/30 p-1.5">
          <Minus size={16} />
        </button>
        <span className="w-12 text-center text-sm tabular-nums">{Math.round(scale * 100)}%</span>
        <button type="button" aria-label="Zoom in" onClick={() => setScale((s) => Math.min(5, s + 0.5))} className="rounded-md border border-white/30 p-1.5">
          <Plus size={16} />
        </button>
        <span className="hidden text-xs text-white/60 sm:inline">Drag to move around</span>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto rounded-md p-1.5 hover:bg-white/10">
          <X size={20} />
        </button>
      </div>
      <div
        ref={box}
        className="flex-1 cursor-grab overflow-auto"
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse") return; // touch scrolls natively
          drag.current = { x: e.clientX, y: e.clientY, l: box.current!.scrollLeft, t: box.current!.scrollTop };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          box.current!.scrollLeft = drag.current.l - (e.clientX - drag.current.x);
          box.current!.scrollTop = drag.current.t - (e.clientY - drag.current.y);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => (drag.current = null)}
        onDoubleClick={() => setScale((s) => (s >= 3 ? 1 : s + 1))}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={which === "clean" ? clean : original} alt="Receipt, zoomed" draggable={false} style={{ width: `${scale * 100}%`, maxWidth: "none" }} className="mx-auto block select-none" />
      </div>
    </div>
  );
}

function CropTool({ rid, page, onClose }: { rid: string; page: Page; onClose: () => void }) {
  const [rotate, setRotate] = useState(page.rotate);
  const [box, setBox] = useState<Crop | null>(page.crop);
  const [state, action, pending] = useFormAction(recropAction, null);
  const frame = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const pos = (e: React.PointerEvent) => {
    const r = frame.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);
  const turn = (d: number) => {
    setRotate((r) => (r + d + 360) % 360);
    setBox(null); // the old box doesn't fit the turned photo
  };
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 text-white" role="dialog" aria-label="Crop receipt">
      <div className="flex flex-wrap items-center gap-2 p-2 text-sm">
        <span className="font-medium">Drag a box around the receipt</span>
        <button type="button" onClick={() => turn(-90)} className="flex items-center gap-1 rounded-md border border-white/30 px-2 py-1">
          <RotateCcw size={15} /> Left
        </button>
        <button type="button" onClick={() => turn(90)} className="flex items-center gap-1 rounded-md border border-white/30 px-2 py-1">
          <RotateCw size={15} /> Right
        </button>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto rounded-md p-1.5 hover:bg-white/10">
          <X size={20} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        <div
          ref={frame}
          className="relative max-h-full touch-none select-none"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            const p = pos(e);
            start.current = p;
            setBox({ x: p.x, y: p.y, w: 0, h: 0 });
          }}
          onPointerMove={(e) => {
            if (!start.current) return;
            const p = pos(e);
            const s = start.current;
            setBox({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
          }}
          onPointerUp={() => (start.current = null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/receipts/${rid}/${page.index}?v=upright&r=${rotate}`} alt="Receipt photo" draggable={false} className="block max-h-[calc(100vh-11rem)] w-auto max-w-full" />
          {box && box.w > 0 && (
            <div
              className="pointer-events-none absolute border-2 border-btr-blue"
              style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`, boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }}
            />
          )}
        </div>
      </div>
      <form onSubmit={action} className="flex flex-wrap items-center gap-2 p-3">
        <input type="hidden" name="id" value={rid} />
        <input type="hidden" name="page" value={page.index} />
        <input type="hidden" name="rotate" value={rotate} />
        <input type="hidden" name="crop" value={box ? JSON.stringify(box) : ""} />
        <Button name="mode" value="box" disabled={pending || !box || box.w < 0.05 || box.h < 0.05}>
          {pending ? "Reading again…" : "Use this crop & re-read"}
        </Button>
        <Button name="mode" value="auto" variant="outline" disabled={pending} className="bg-transparent text-white">
          Auto-detect the paper
        </Button>
        <Button name="mode" value="none" variant="outline" disabled={pending} className="bg-transparent text-white">
          Whole photo
        </Button>
        <span className="text-xs text-white/60">Re-reading takes about 20 seconds.</span>
        <Problems state={state} className="w-full" />
      </form>
    </div>
  );
}
