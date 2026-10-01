"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * Address box with suggestions: type a few characters and the top matches drop down (↑/↓, Enter, or click).
 * "📍" fills the address where you're standing and biases later suggestions near you.
 */
export function AddressInput({ name = "address", value, onChange, placeholder, ariaLabel }: { name?: string; value: string; onChange: (v: string) => void; placeholder?: string; ariaLabel?: string }) {
  const [list, setList] = useState<string[]>([]);
  const [hi, setHi] = useState(-1);
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const near = useRef<{ lat: number; lon: number } | null>(null);
  const typed = useRef(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!typed.current) return;
    const q = value.trim();
    if (q.length < 4) return setList([]);
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const n = near.current ? `&lat=${near.current.lat}&lon=${near.current.lon}` : "";
        const r = await fetch(`/api/address?q=${encodeURIComponent(q)}${n}`, { signal: ctl.signal });
        const j = (await r.json()) as { suggestions: { label: string }[] };
        setList(j.suggestions.map((s) => s.label).filter((s) => s.toLowerCase() !== q.toLowerCase()));
        setHi(-1);
        setOpen(true);
      } catch {
        /* typing again cancels the last lookup */
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [value]);

  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (s: string) => {
    typed.current = false;
    onChange(s);
    setOpen(false);
    setList([]);
  };

  const locate = () => {
    if (!navigator.geolocation) return setNote("This device can't share its location.");
    setLocating(true);
    setNote(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        near.current = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        try {
          const r = await fetch(`/api/address?reverse=1&lat=${near.current.lat}&lon=${near.current.lon}`);
          const j = (await r.json()) as { address?: string | null };
          if (j.address) {
            pick(j.address);
            setNote("Filled from your location — check the house number.");
          } else setNote("Couldn't find an address here; type it in.");
        } catch {
          setNote("Couldn't look up your location.");
        }
        setLocating(false);
      },
      () => {
        setLocating(false);
        setNote("Location is off for this site.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const show = open && list.length > 0;
  return (
    <div ref={box} className="relative">
      <div className="flex gap-2">
        <Input
          name={name}
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoComplete="off"
          role="combobox"
          aria-expanded={show}
          aria-autocomplete="list"
          onChange={(e) => {
            typed.current = true;
            setNote(null);
            onChange(e.target.value);
          }}
          onFocus={() => list.length && setOpen(true)}
          onKeyDown={(e) => {
            if (!show) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHi((h) => Math.min(h + 1, list.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter" && hi >= 0) {
              e.preventDefault();
              pick(list[hi]);
            } else if (e.key === "Escape") setOpen(false);
          }}
        />
        <button type="button" onClick={locate} disabled={locating} title="Use my location" aria-label="Use my location" className="shrink-0 rounded-md border border-input px-3 text-sm hover:bg-accent disabled:opacity-50">
          {locating ? "…" : "📍"}
        </button>
      </div>
      {show && (
        <ul role="listbox" className="absolute z-40 mt-1 w-full overflow-hidden rounded-md border bg-background py-1 text-sm shadow-lg">
          {list.map((s, i) => (
            <li
              key={s}
              role="option"
              aria-selected={i === hi}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              onMouseEnter={() => setHi(i)}
              className={`cursor-pointer px-3 py-2 ${i === hi ? "bg-btr-blue-soft" : ""}`}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
