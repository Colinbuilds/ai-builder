"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { aiMeasureAction, saveTakeoffAction, sendTakeoffAction } from "@/app/projects/takeoff-actions";
import {
  fmtFeet,
  measureItem,
  pageTotals,
  parseFeet,
  pathLength,
  PRESET_SCALES,
  presetUpf,
  rectCorners,
  round,
  TAKEOFF_TYPES,
  TYPE_BY_ID,
  type PageTakeoff,
  type Pt,
  type Scale,
  type TakeoffItem,
  type View,
} from "@/lib/takeoff/geometry";

type PdfPage = {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown; transform?: number[] }): { promise: Promise<void>; cancel(): void };
};
type Mode = "draw" | "select" | "pan" | "calibrate" | "check";

const uid = () => Math.random().toString(36).slice(2, 10);
const BASE_MAX = 4096; // longest side of the whole-sheet base image, in device pixels

/**
 * Manual plan takeoff for one sheet. Set the scale (calibrate on a printed dimension, or a printed scale on a
 * full-size PDF), check it against a second dimension, then trace. Lengths on a roof plan get the pitch factor.
 * Everything autosaves; "Send to job" writes this sheet's totals to the job's measurements.
 */
export function TakeoffEditor({
  documentId,
  fileUrl,
  kind,
  page,
  pageCount,
  initial,
  allowancePct,
  canEdit,
  projectId,
  fileName,
  savedToJob,
}: {
  documentId: string;
  fileUrl: string;
  kind: "pdf" | "image";
  page: number;
  pageCount: number;
  initial: PageTakeoff | null;
  allowancePct: number;
  canEdit: boolean;
  projectId: string;
  fileName: string;
  savedToJob: string | null;
}) {
  const [view, setView] = useState<View>(initial?.view ?? "ROOF_PLAN");
  const [pitch, setPitch] = useState<number | null>(initial?.pitch ?? null);
  const [scale, setScale] = useState<Scale | null>(initial?.scale ?? null);
  const [items, setItems] = useState<TakeoffItem[]>(initial?.items ?? []);
  const [typeId, setTypeId] = useState(initial?.view === "ELEVATION" ? "wall_area" : "roof_area");
  const [mode, setMode] = useState<Mode>(canEdit ? (initial?.scale ? "draw" : "calibrate") : "pan");
  const [draft, setDraft] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [status, setStatus] = useState<string>("");
  const [lenInput, setLenInput] = useState("");
  const [pending2, setPending2] = useState<Pt[] | null>(null); // two points waiting for a typed length
  const [history, setHistory] = useState<TakeoffItem[][]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pages, setPages] = useState(pageCount);
  const [ai, setAi] = useState<{ busy: boolean; message?: string; cannot?: string[] }>({ busy: false });

  const scroller = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const baseCanvas = useRef<HTMLCanvasElement>(null);
  const detailCanvas = useRef<HTMLCanvasElement>(null);
  const pdfPage = useRef<PdfPage | null>(null);
  const imgEl = useRef<HTMLImageElement | null>(null);
  const renderTask = useRef<{ cancel(): void } | null>(null);
  const panStart = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const spaceDown = useRef(false);
  const dirty = useRef(false);

  const type = TYPE_BY_ID.get(typeId)!;
  const pageData: PageTakeoff = useMemo(() => ({ view, pitch, scale, items }), [view, pitch, scale, items]);
  const { totals, problems } = useMemo(() => pageTotals(pageData, allowancePct), [pageData, allowancePct]);

  // ---------- load the sheet ----------
  useEffect(() => {
    let dead = false;
    if (kind === "image") {
      const img = new Image();
      img.onload = () => {
        if (dead) return;
        imgEl.current = img;
        setSize({ w: img.naturalWidth, h: img.naturalHeight });
      };
      img.onerror = () => !dead && setLoadErr("Couldn't open this image.");
      img.src = fileUrl;
      return () => void (dead = true);
    }
    (async () => {
      try {
        const pdfjs = await import(/* webpackIgnore: true */ "/api/pdfjs/pdf.min.mjs" as string);
        pdfjs.GlobalWorkerOptions.workerSrc = "/api/pdfjs/pdf.worker.min.mjs";
        const doc = await pdfjs.getDocument({ url: fileUrl }).promise;
        if (!dead) setPages(doc.numPages);
        const p = (await doc.getPage(page)) as PdfPage;
        if (dead) return;
        pdfPage.current = p;
        const vp = p.getViewport({ scale: 1 });
        setSize({ w: vp.width, h: vp.height });
      } catch {
        if (!dead) setLoadErr("Couldn't open this PDF page.");
      }
    })();
    return () => void (dead = true);
  }, [fileUrl, kind, page]);

  // fit to width once the sheet size is known
  useEffect(() => {
    if (!size || !scroller.current) return;
    setZoom(Math.max(0.1, (scroller.current.clientWidth - 24) / size.w));
  }, [size]);

  // whole-sheet base render (moderate resolution)
  useEffect(() => {
    const p = pdfPage.current;
    const c = baseCanvas.current;
    if (!p || !c || !size) return;
    const s = Math.min(BASE_MAX / Math.max(size.w, size.h), 3);
    const vp = p.getViewport({ scale: s });
    c.width = Math.floor(vp.width);
    c.height = Math.floor(vp.height);
    const t = p.render({ canvasContext: c.getContext("2d")!, viewport: vp });
    t.promise.catch(() => {});
  }, [size]);

  // sharp render of just the visible area at the current zoom
  const renderDetail = useCallback(() => {
    const p = pdfPage.current;
    const c = detailCanvas.current;
    const sc = scroller.current;
    if (!p || !c || !sc || !size) return;
    renderTask.current?.cancel();
    const dpr = window.devicePixelRatio || 1;
    const left = sc.scrollLeft;
    const top = sc.scrollTop;
    const w = Math.min(sc.clientWidth, size.w * zoom);
    const h = Math.min(sc.clientHeight, size.h * zoom);
    c.style.left = `${left}px`;
    c.style.top = `${top}px`;
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    const vp = p.getViewport({ scale: zoom * dpr });
    const t = p.render({ canvasContext: c.getContext("2d")!, viewport: vp, transform: [1, 0, 0, 1, -left * dpr, -top * dpr] });
    renderTask.current = t;
    t.promise.catch(() => {});
  }, [size, zoom]);
  useEffect(() => {
    if (kind !== "pdf") return;
    const sc = scroller.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const go = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(renderDetail, 120);
    };
    go();
    sc?.addEventListener("scroll", go);
    window.addEventListener("resize", go);
    return () => {
      if (timer) clearTimeout(timer);
      sc?.removeEventListener("scroll", go);
      window.removeEventListener("resize", go);
    };
  }, [kind, renderDetail]);

  // ---------- autosave ----------
  const save = useCallback(async () => {
    if (!canEdit || !dirty.current) return true;
    dirty.current = false;
    setStatus("Saving…");
    const r = await saveTakeoffAction(documentId, page, { ...pageData, width: size?.w ?? null, height: size?.h ?? null });
    setStatus(r.ok ? "Saved" : (r.message ?? "Couldn't save"));
    if (!r.ok) dirty.current = true;
    return r.ok;
  }, [canEdit, documentId, page, pageData, size]);
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(save, 1200);
    return () => clearTimeout(t);
  }, [pageData, save]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const touch = () => (dirty.current = true);

  const commitItems = (next: TakeoffItem[]) => {
    setHistory((h) => [...h.slice(-49), items]);
    setItems(next);
    touch();
  };
  const undo = () => {
    if (draft.length) return setDraft((d) => d.slice(0, -1));
    setHistory((h) => {
      if (!h.length) return h;
      setItems(h[h.length - 1]);
      touch();
      return h.slice(0, -1);
    });
  };

  // ---------- AI draft of what's on screen ----------
  const AI_MAX = 2000; // longest side of the image sent, in pixels
  const aiMeasure = async () => {
    const sc = scroller.current;
    if (!sc || !size) return;
    // the visible part of the sheet, in sheet units
    const x = Math.max(0, sc.scrollLeft / zoom);
    const y = Math.max(0, sc.scrollTop / zoom);
    const region = { x, y, w: Math.min(size.w - x, sc.clientWidth / zoom), h: Math.min(size.h - y, sc.clientHeight / zoom) };
    if (region.w <= 0 || region.h <= 0) return;
    setAi({ busy: true, message: "Reading the plan on screen… this takes up to a minute." });
    try {
      const s = Math.min(AI_MAX / Math.max(region.w, region.h), 8);
      const c = document.createElement("canvas");
      c.width = Math.round(region.w * s);
      c.height = Math.round(region.h * s);
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      if (kind === "pdf" && pdfPage.current) {
        const vp = pdfPage.current.getViewport({ scale: s });
        await pdfPage.current.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -region.x * s, -region.y * s] }).promise;
      } else if (imgEl.current) {
        ctx.drawImage(imgEl.current, region.x, region.y, region.w, region.h, 0, 0, c.width, c.height);
      } else throw new Error("The sheet isn't loaded yet.");
      const imageBase64 = c.toDataURL("image/jpeg", 0.9).split(",")[1];
      const r = await aiMeasureAction(documentId, { imageBase64, mediaType: "image/jpeg", region, view });
      if (!r.ok) return setAi({ busy: false, message: r.message });
      const notes: string[] = [];
      // BTRbot read what the sheet really is: switch the setting rather than refusing
      if (r.detectedView && r.detectedView !== view) {
        setView(r.detectedView);
        touch();
        notes.push(`This is ${r.detectedView === "ELEVATION" ? "an elevation" : "a roof plan"}, so the sheet setting was switched to ${r.detectedView === "ELEVATION" ? "Elevation" : "Roof plan"}.`);
      }
      // no scale yet and the sheet prints one: start from it (PDF sizes are true), then ask for a check
      if (!scale && r.printedScale && kind === "pdf") {
        const p = PRESET_SCALES.find((x) => x.label === r.printedScale);
        if (p) {
          setScale({ upf: presetUpf(p.inPerFt), method: "PRESET", label: `Printed scale ${p.label}`, check: null });
          touch();
          notes.push(`Scale set from the printed ${p.label}. Check it on one known dimension before using the numbers.`);
        }
      } else if (!scale && r.printedScale) notes.push(`The sheet says ${r.printedScale}. Set the scale (Set scale → calibrate on a dimension).`);
      if (!r.items.length) {
        const why =
          r.sheetType === "FLOOR_PLAN"
            ? "This is a floor plan, so there's nothing to take off here. Open the roof plan or the elevations."
            : r.detectedView
              ? "BTRbot couldn't trace anything it was sure of here. Zoom in on one roof or one wall and try again."
              : "This isn't a roof plan or an elevation. Open the roof plan or the elevations.";
        return setAi({ busy: false, message: [...notes, why].join(" "), cannot: r.cannotTrace });
      }
      commitItems([...items, ...r.items]);
      setMode("select");
      setAi({
        busy: false,
        message: [...notes, `BTRbot drew ${r.items.length} item${r.items.length === 1 ? "" : "s"} (dashed) on ${r.sheet}. Check each against the plan — fix or delete what's wrong, then accept. They don't count until accepted.`].join(" "),
        cannot: r.cannotTrace,
      });
    } catch (e) {
      setAi({ busy: false, message: e instanceof Error ? e.message : "Couldn't capture the sheet." });
    }
  };
  const aiCount = items.filter((i) => i.ai).length;
  const acceptAi = (id?: string) => commitItems(items.map((i) => (i.ai && (!id || i.id === id) ? { ...i, ai: undefined, note: i.note?.replace(/^BTRbot: /, "BTRbot (checked): ") ?? null } : i)));

  // ---------- pointer → sheet coordinates ----------
  const toSheet = (e: { clientX: number; clientY: number }, constrain: boolean): Pt => {
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    let x = (e.clientX - r.left) / zoom;
    let y = (e.clientY - r.top) / zoom;
    const last = draft[draft.length - 1];
    if (constrain && last) {
      // Shift: lock to 0°, 45° or 90° from the last point
      const dx = x - last[0];
      const dy = y - last[1];
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(dx, dy);
      x = last[0] + Math.cos(ang) * len;
      y = last[1] + Math.sin(ang) * len;
    }
    return [round(x, 3), round(y, 3)];
  };

  const finishDraft = useCallback(
    (pts = draft) => {
      const t = TYPE_BY_ID.get(typeId)!;
      const need = t.tool === "area" ? 3 : 2;
      if (pts.length >= need) commitItems([...items, { id: uid(), type: typeId, points: pts }]);
      setDraft([]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, typeId, items],
  );

  const onClick = (e: React.MouseEvent) => {
    if (!canEdit || mode === "pan" || spaceDown.current) return;
    if (mode === "select") return setSelected(null);
    const p = toSheet(e, e.shiftKey);
    if (mode === "calibrate" || mode === "check") {
      const next = [...draft, p];
      if (next.length === 2) {
        setPending2(next);
        setDraft([]);
        setLenInput("");
      } else setDraft(next);
      return;
    }
    if (!scale && type.tool !== "count") {
      setStatus("Set the scale first.");
      return;
    }
    if (type.tool === "count") return commitItems([...items, { id: uid(), type: typeId, points: [p] }]);
    if (type.tool === "rect") {
      if (draft.length === 1) {
        commitItems([...items, { id: uid(), type: typeId, points: [draft[0], p] }]);
        setDraft([]);
      } else setDraft([p]);
      return;
    }
    setDraft([...draft, p]);
  };

  const onDouble = (e: React.MouseEvent) => {
    if (mode !== "draw" || type.tool === "count" || type.tool === "rect") return;
    e.preventDefault();
    // the double click's second click already added a point twice; drop the duplicate
    const pts = draft.length >= 2 && draft[draft.length - 1][0] === draft[draft.length - 2][0] ? draft.slice(0, -1) : draft;
    finishDraft(pts);
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, select, textarea")) return;
      if (e.key === " ") {
        spaceDown.current = true;
        e.preventDefault();
      }
      if (e.key === "Enter") finishDraft();
      if (e.key === "Escape") {
        setDraft([]);
        setPending2(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        commitItems(items.filter((i) => i.id !== selected));
        setSelected(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
    };
    const up = (e: KeyboardEvent) => e.key === " " && (spaceDown.current = false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });

  // pan by dragging (pan mode, or holding space)
  const onPointerDown = (e: React.PointerEvent) => {
    if (mode !== "pan" && !spaceDown.current && e.button !== 1) return;
    const sc = scroller.current!;
    panStart.current = { x: e.clientX, y: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (panStart.current) {
      const sc = scroller.current!;
      sc.scrollLeft = panStart.current.sl - (e.clientX - panStart.current.x);
      sc.scrollTop = panStart.current.st - (e.clientY - panStart.current.y);
      return;
    }
    if (draft.length) setHover(toSheet(e, e.shiftKey));
  };
  const onPointerUp = () => (panStart.current = null);

  const zoomBy = (f: number) => {
    const sc = scroller.current;
    if (!sc) return setZoom((z) => z * f);
    const cx = (sc.scrollLeft + sc.clientWidth / 2) / zoom;
    const cy = (sc.scrollTop + sc.clientHeight / 2) / zoom;
    const nz = Math.min(12, Math.max(0.05, zoom * f));
    setZoom(nz);
    requestAnimationFrame(() => {
      sc.scrollLeft = cx * nz - sc.clientWidth / 2;
      sc.scrollTop = cy * nz - sc.clientHeight / 2;
    });
  };
  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    sc.addEventListener("wheel", wheel, { passive: false });
    return () => sc.removeEventListener("wheel", wheel);
  });

  // ---------- scale ----------
  const applyLength = () => {
    if (!pending2) return;
    const ft = parseFeet(lenInput);
    if (!ft || ft <= 0) return setStatus("Type the real length, e.g. 120' or 24'-6\".");
    const units = pathLength(pending2);
    if (mode === "calibrate") {
      setScale({ upf: units / ft, method: "CALIBRATED", label: `Calibrated on ${fmtFeet(ft)}`, check: null });
      setStatus(`Scale set from ${fmtFeet(ft)}. Now check it on a second dimension.`);
      setMode("check");
    } else if (scale) {
      const measured = units / scale.upf;
      const diffPct = ((measured - ft) / ft) * 100;
      setScale({ ...scale, check: { expectedFt: ft, measuredFt: round(measured, 3), diffPct: round(diffPct, 3) } });
      setStatus(Math.abs(diffPct) <= 1 ? `Scale checks out (${diffPct >= 0 ? "+" : ""}${diffPct.toFixed(2)}%).` : `Off by ${diffPct.toFixed(2)}%. Re-calibrate on a longer dimension.`);
      setMode("draw");
    }
    setPending2(null);
    touch();
  };
  const choosePreset = (label: string) => {
    const p = PRESET_SCALES.find((s) => s.label === label);
    if (!p) return;
    setScale({ upf: presetUpf(p.inPerFt), method: "PRESET", label: `Printed scale ${p.label}`, check: null });
    setStatus("Printed scale set. Half-size sets throw this off 2×, so check it on a known dimension.");
    setMode("check");
    touch();
  };

  // ---------- drawing helpers ----------
  const pts = (it: TakeoffItem) => (TYPE_BY_ID.get(it.type)?.tool === "rect" && it.points.length === 2 ? rectCorners(it.points[0], it.points[1]) : it.points);
  const poly = (p: Pt[]) => p.map(([x, y]) => `${x},${y}`).join(" ");
  const sel = items.find((i) => i.id === selected) ?? null;
  const selResult = sel ? measureItem(sel, pageData) : null;
  const liveLen = draft.length && hover && scale ? pathLength([...draft, hover]) / scale.upf : null;
  const markR = 6 / zoom;
  const groups = ["Roof", "Siding", "Other"] as const;

  const send = async () => {
    if (!(await save())) return;
    setStatus("Sending…");
    const r = await sendTakeoffAction(documentId, page);
    setStatus(r.message ?? (r.ok ? "Sent" : "Couldn't send"));
  };

  return (
    <div className="flex flex-col gap-3">
      {/* sheet bar */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={`/projects/${projectId}/takeoff`} className="text-muted-foreground hover:underline">
          ← Takeoff
        </Link>
        <span className="font-medium">{fileName}</span>
        {pages > 1 && (
          <span className="flex items-center gap-1">
            {page > 1 && (
              <Link onClick={() => void save()} href={`?page=${page - 1}`} className="rounded border px-2 py-0.5 hover:bg-accent">
                ‹
              </Link>
            )}
            <span>
              Page {page} of {pages}
            </span>
            {page < pages && (
              <Link onClick={() => void save()} href={`?page=${page + 1}`} className="rounded border px-2 py-0.5 hover:bg-accent">
                ›
              </Link>
            )}
          </span>
        )}
        <label className="flex items-center gap-1">
          Sheet is
          <select
            value={view}
            disabled={!canEdit}
            onChange={(e) => {
              setView(e.target.value as View);
              touch();
            }}
            className="h-8 rounded-md border border-input bg-background px-1"
          >
            <option value="ROOF_PLAN">Roof plan (pitch applies)</option>
            <option value="ELEVATION">Elevation (true size)</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        {view === "ROOF_PLAN" && (
          <label className="flex items-center gap-1">
            Pitch
            <input
              value={pitch ?? ""}
              disabled={!canEdit}
              inputMode="decimal"
              onChange={(e) => {
                const v = e.target.value.trim();
                setPitch(v === "" ? null : Number(v));
                touch();
              }}
              className="h-8 w-14 rounded-md border border-input bg-background px-2"
              placeholder="—"
              aria-label="Pitch, rise per 12"
            />
            /12
          </label>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{status}</span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
        <div className="flex min-w-0 flex-col gap-2">
          {/* tools */}
          {canEdit && (
            <div className="flex flex-wrap items-center gap-1 text-sm">
              {(
                [
                  ["draw", "Measure"],
                  ["select", "Select"],
                  ["pan", "Move"],
                  ["calibrate", "Set scale"],
                  ["check", "Check scale"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  disabled={m === "check" && !scale}
                  onClick={() => {
                    setMode(m);
                    setDraft([]);
                    setPending2(null);
                  }}
                  className={`rounded-md border px-2.5 py-1 disabled:opacity-40 ${mode === m ? "border-btr-black bg-btr-black text-white" : "hover:bg-accent"}`}
                >
                  {label}
                </button>
              ))}
              <span className="mx-1 h-5 w-px bg-btr-line" />
              <button type="button" onClick={undo} className="rounded-md border px-2.5 py-1 hover:bg-accent" title="Undo (Ctrl+Z)">
                Undo
              </button>
              <button
                type="button"
                onClick={aiMeasure}
                disabled={ai.busy || !size}
                className="rounded-md border border-violet-400 bg-violet-50 px-2.5 py-1 text-violet-900 hover:bg-violet-100 disabled:opacity-50 dark:bg-violet-950 dark:text-violet-200"
                title="BTRbot traces what's on screen as dashed drafts. Zoom to one roof plan or elevation first for the best result."
              >
                {ai.busy ? "BTRbot measuring…" : "BTRbot measure on screen"}
              </button>
              <button type="button" onClick={() => zoomBy(1 / 1.25)} className="rounded-md border px-2.5 py-1 hover:bg-accent" aria-label="Zoom out">
                −
              </button>
              <span className="w-12 text-center tabular-nums text-xs">{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => zoomBy(1.25)} className="rounded-md border px-2.5 py-1 hover:bg-accent" aria-label="Zoom in">
                +
              </button>
              <button type="button" onClick={() => size && scroller.current && setZoom((scroller.current.clientWidth - 24) / size.w)} className="rounded-md border px-2.5 py-1 hover:bg-accent">
                Fit
              </button>
            </div>
          )}

          {/* what the click does right now */}
          <div className="rounded-md bg-btr-blue-soft px-3 py-2 text-sm">
            {pending2 ? (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  applyLength();
                }}
              >
                <span>{mode === "calibrate" ? "Real length of that line:" : "What should that dimension be?"}</span>
                <input autoFocus value={lenInput} onChange={(e) => setLenInput(e.target.value)} placeholder={`e.g. 120' or 24'-6"`} className="h-8 w-32 rounded-md border border-input bg-background px-2" aria-label="Real length" />
                <button className="rounded-md bg-btr-black px-3 py-1 text-white">{mode === "calibrate" ? "Set scale" : "Check"}</button>
                <button type="button" onClick={() => setPending2(null)} className="text-muted-foreground hover:underline">
                  Cancel
                </button>
              </form>
            ) : mode === "calibrate" ? (
              <span>
                Click both ends of a dimension printed on the sheet, then type its length. Use the longest dimension you can find and zoom in on each end: a short scale bar on a low-resolution sheet can be off by several percent.
                {kind === "pdf" && (
                  <>
                    {" "}Or use the printed scale:{" "}
                    <select defaultValue="" onChange={(e) => choosePreset(e.target.value)} className="h-7 rounded border border-input bg-background px-1" aria-label="Printed scale">
                      <option value="" disabled>
                        pick…
                      </option>
                      {PRESET_SCALES.map((s) => (
                        <option key={s.label}>{s.label}</option>
                      ))}
                    </select>
                  </>
                )}
              </span>
            ) : mode === "check" ? (
              <span>Click both ends of a second known dimension to confirm the scale (must be within 1%).</span>
            ) : mode === "draw" ? (
              <span>
                <b>{type.label}</b>:{" "}
                {type.tool === "count"
                  ? "click each one."
                  : type.tool === "rect"
                    ? "click two opposite corners."
                    : `click point to point; double-click or Enter to finish${type.tool === "area" ? " (it closes itself)" : ""}. Shift locks to 0°/45°/90°. Esc cancels.`}
                {liveLen != null && <span className="ml-2 font-medium tabular-nums">{round(liveLen)} ft</span>}
                {type.hint && <span className="block text-xs text-muted-foreground">{type.hint}</span>}
              </span>
            ) : mode === "select" ? (
              <span>Click a line, area or mark to see it; Delete removes it.</span>
            ) : (
              <span>Drag to move around. Ctrl + scroll zooms. Hold Space to move while measuring.</span>
            )}
          </div>

          {/* sheet */}
          <div
            ref={scroller}
            className="relative h-[70vh] overflow-auto rounded-md border bg-neutral-200 dark:bg-neutral-800"
            style={{ cursor: mode === "pan" ? "grab" : mode === "select" ? "default" : "crosshair" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {loadErr && <p className="p-4 text-sm text-red-600">{loadErr}</p>}
            {!size && !loadErr && <p className="p-4 text-sm text-muted-foreground">Opening the sheet…</p>}
            {size && (
              <div className="relative" style={{ width: size.w * zoom, height: size.h * zoom }}>
                {kind === "pdf" ? (
                  <>
                    <canvas ref={baseCanvas} className="absolute inset-0 bg-white" style={{ width: size.w * zoom, height: size.h * zoom }} />
                    <canvas ref={detailCanvas} className="pointer-events-none absolute" />
                  </>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={fileUrl} alt={fileName} className="absolute inset-0 select-none" draggable={false} style={{ width: size.w * zoom, height: size.h * zoom, maxWidth: "none" }} />
                )}
                <svg
                  ref={svgRef}
                  aria-label="Plan sheet"
                  className="absolute inset-0"
                  width={size.w * zoom}
                  height={size.h * zoom}
                  viewBox={`0 0 ${size.w} ${size.h}`}
                  onClick={onClick}
                  onDoubleClick={onDouble}
                >
                  {items.map((it) => {
                    const t = TYPE_BY_ID.get(it.type);
                    if (!t) return null;
                    const on = it.id === selected;
                    const common = {
                      stroke: t.color,
                      strokeDasharray: it.ai ? "7 5" : undefined,
                      vectorEffect: "non-scaling-stroke" as const,
                      onClick: (e: React.MouseEvent) => {
                        if (mode !== "select") return;
                        e.stopPropagation();
                        setSelected(it.id);
                      },
                      style: { cursor: mode === "select" ? "pointer" : undefined },
                    };
                    if (t.tool === "count")
                      return <circle key={it.id} cx={it.points[0][0]} cy={it.points[0][1]} r={markR} fill={t.color} fillOpacity={0.85} strokeWidth={on ? 3 : 1} {...common} stroke={on ? "#000" : "#fff"} />;
                    if (t.tool === "line") return <polyline key={it.id} points={poly(it.points)} fill="none" strokeWidth={on ? 5 : 3} strokeLinecap="round" strokeLinejoin="round" {...common} />;
                    return <polygon key={it.id} points={poly(pts(it))} fill={t.color} fillOpacity={t.id === "masonry" || t.id === "rough_opening" ? 0.35 : 0.18} strokeWidth={on ? 4 : 2} {...common} />;
                  })}
                  {/* in-progress shape */}
                  {draft.length > 0 && (
                    <>
                      {mode === "draw" && type.tool === "rect" && hover ? (
                        <polygon points={poly(rectCorners(draft[0], hover))} fill={type.color} fillOpacity={0.2} stroke={type.color} strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
                      ) : (
                        <polyline
                          points={poly(hover ? [...draft, hover] : draft)}
                          fill="none"
                          stroke={mode === "draw" ? type.color : "#e11d48"}
                          strokeWidth={2.5}
                          strokeDasharray="6 4"
                          vectorEffect="non-scaling-stroke"
                        />
                      )}
                      {draft.map(([x, y], i) => (
                        <circle key={i} cx={x} cy={y} r={markR * 0.6} fill="#fff" stroke="#000" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                      ))}
                    </>
                  )}
                </svg>
              </div>
            )}
          </div>
        </div>

        {/* side panel */}
        <aside className="flex min-w-0 flex-col gap-3 text-sm">
          <div className="rounded-md border p-3">
            <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Scale</div>
            {scale ? (
              <div className="mt-1 flex flex-col gap-0.5">
                <span>{scale.label}</span>
                {scale.check ? (
                  <span className={Math.abs(scale.check.diffPct) <= 1 ? "text-green-700 dark:text-green-400" : "text-red-600"}>
                    Checked on {fmtFeet(scale.check.expectedFt)}: {scale.check.diffPct >= 0 ? "+" : ""}
                    {scale.check.diffPct.toFixed(2)}%
                  </span>
                ) : (
                  <span className="text-amber-700 dark:text-amber-400">Not checked yet</span>
                )}
              </div>
            ) : (
              <p className="mt-1 text-amber-700 dark:text-amber-400">Not set — use Set scale.</p>
            )}
          </div>

          {canEdit && (
            <div className="rounded-md border p-3">
              <div className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Measure</div>
              {groups.map((g) => (
                <div key={g} className="mb-2">
                  <div className="text-xs text-muted-foreground">{g}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {TAKEOFF_TYPES.filter((t) => t.group === g).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setTypeId(t.id);
                          setMode("draw");
                          setDraft([]);
                        }}
                        className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${typeId === t.id && mode === "draw" ? "border-btr-black bg-btr-black text-white" : "hover:bg-accent"}`}
                      >
                        <span className="inline-block size-2.5 rounded-full" style={{ background: t.color }} />
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {sel && (
            <div className="rounded-md border p-3">
              <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Selected</div>
              <div className="mt-1 font-medium">{TYPE_BY_ID.get(sel.type)?.label}</div>
              <div className="text-muted-foreground">{selResult ? `${round(selResult.value)} ${TYPE_BY_ID.get(sel.type)?.unit} · ${selResult.formula}` : "Needs a scale or pitch"}</div>
              {view === "ROOF_PLAN" && TYPE_BY_ID.get(sel.type)?.pitch !== "none" && canEdit && (
                <label className="mt-1 flex items-center gap-1">
                  Own pitch
                  <input
                    defaultValue={sel.pitch ?? ""}
                    inputMode="decimal"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      commitItems(items.map((i) => (i.id === sel.id ? { ...i, pitch: v === "" ? null : Number(v) } : i)));
                    }}
                    className="h-7 w-14 rounded border border-input bg-background px-1"
                    placeholder={pitch != null ? String(pitch) : "—"}
                  />
                  /12
                </label>
              )}
              {sel.note && <div className="mt-1 text-xs text-muted-foreground">{sel.note}</div>}
              {canEdit && (
                <div className="mt-2 flex gap-3">
                  {sel.ai && (
                    <button type="button" onClick={() => acceptAi(sel.id)} className="text-violet-700 hover:underline dark:text-violet-300">
                      Accept this BTRbot line
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      commitItems(items.filter((i) => i.id !== sel.id));
                      setSelected(null);
                    }}
                    className="text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          )}

          {(ai.message || aiCount > 0) && (
            <div className="rounded-md border border-violet-300 bg-violet-50/60 p-3 dark:border-violet-800 dark:bg-violet-950/40">
              <div className="text-xs font-semibold tracking-wide text-violet-800 uppercase dark:text-violet-300">BTRbot measure</div>
              {ai.message && <p className="mt-1">{ai.message}</p>}
              {ai.cannot && ai.cannot.length > 0 && (
                <div className="mt-1 text-xs">
                  Trace by hand:
                  <ul className="list-disc pl-4">
                    {ai.cannot.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
              {aiCount > 0 && canEdit && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => acceptAi()} className="rounded-md bg-violet-700 px-2.5 py-1 text-white hover:bg-violet-800">
                    Accept all {aiCount} after checking
                  </button>
                  <button type="button" onClick={() => commitItems(items.filter((i) => !i.ai))} className="rounded-md border px-2.5 py-1 hover:bg-accent">
                    Remove BTRbot drafts
                  </button>
                </div>
              )}
              <p className="mt-2 text-xs text-muted-foreground">BTRbot only draws; lengths and areas come from this sheet&apos;s checked scale. Set and check the scale first.</p>
            </div>
          )}

          <div className="rounded-md border p-3">
            <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">This sheet</div>
            {totals.length ? (
              <table className="mt-1 w-full text-sm">
                <tbody>
                  {totals.map((t) => (
                    <tr key={t.key} className="border-t first:border-t-0" title={t.formula}>
                      <td className="py-1 pr-2">{t.label}</td>
                      <td className="py-1 text-right font-medium whitespace-nowrap tabular-nums">
                        {t.value.toLocaleString()} {t.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-1 text-muted-foreground">Nothing measured yet.</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Lengths and areas include the {allowancePct}% takeoff allowance, rounded up. Hover a row for the math. Waste is added on the estimate.
            </p>
            {problems.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-xs text-amber-800 dark:text-amber-300">
                {problems.map((p) => (
                  <li key={p}>⚠ {p}</li>
                ))}
              </ul>
            )}
            {canEdit && (
              <button type="button" onClick={send} disabled={!totals.length} className="mt-3 w-full rounded-md bg-btr-blue px-3 py-2 font-medium text-white hover:bg-btr-blue-dark disabled:opacity-40">
                Send to job measurements
              </button>
            )}
            {savedToJob && <p className="mt-1 text-xs text-muted-foreground">Last sent {savedToJob}. Sending again replaces this sheet&apos;s numbers.</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}
