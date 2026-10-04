"use client";

import { useActionState, useState } from "react";
import { renderAction } from "@/app/quote/actions";

type Opt = { key: string; label: string; hex: string };
const swatch = (o: Opt, on: boolean) => `flex items-center gap-2 rounded-lg border p-2 text-left text-sm ${on ? "border-btr-blue ring-2 ring-btr-blue" : "border-btr-line"}`;

/** Pick a photo and a look; the server makes a concept rendering on the customer's own photo. */
export function Studio(props: { token: string; photos: number; roof: boolean; siding: boolean; roofStyles: Opt[]; roofColors: Opt[]; sidingStyles: Opt[]; sidingColors: Opt[]; trims: Opt[]; left: number; enabled: boolean }) {
  const [state, action, pending] = useActionState(renderAction, null);
  const [photo, setPhoto] = useState(0);
  const [roofStyle, setRoofStyle] = useState(props.roof ? "shingle" : "");
  const [roofColor, setRoofColor] = useState("");
  const [sidingStyle, setSidingStyle] = useState(props.siding ? "lap" : "");
  const [sidingColor, setSidingColor] = useState("");
  const [trim, setTrim] = useState("");
  const [showRoof, setShowRoof] = useState(props.roof || !props.siding);
  const [showSiding, setShowSiding] = useState(props.siding);
  const Group = ({ title, list, value, set, dots = true }: { title: string; list: Opt[]; value: string; set: (k: string) => void; dots?: boolean }) => (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium">{title}</p>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
        {list.map((o) => (
          <button type="button" key={o.key} onClick={() => set(value === o.key ? "" : o.key)} className={swatch(o, value === o.key)}>
            {dots && <span className="size-6 shrink-0 rounded border border-black/10" style={{ background: o.hex }} />}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={props.token} />
      <input type="hidden" name="photo" value={photo} />
      <input type="hidden" name="roofStyle" value={showRoof ? roofStyle : ""} />
      <input type="hidden" name="roofColor" value={showRoof ? roofColor : ""} />
      <input type="hidden" name="sidingStyle" value={showSiding ? sidingStyle : ""} />
      <input type="hidden" name="sidingColor" value={showSiding ? sidingColor : ""} />
      <input type="hidden" name="trim" value={trim} />
      {props.photos > 1 && (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Which photo?</p>
          <div className="flex gap-2 overflow-x-auto">
            {Array.from({ length: props.photos }, (_, i) => (
              <button type="button" key={i} onClick={() => setPhoto(i)} className={`shrink-0 rounded-lg ${photo === i ? "ring-2 ring-btr-blue" : ""}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/q/${props.token}/photo/${i}?w=200`} alt={`Photo ${i + 1}`} className="h-20 w-20 rounded-lg object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showRoof} onChange={(e) => setShowRoof(e.target.checked)} className="size-5" /> New roof
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showSiding} onChange={(e) => setShowSiding(e.target.checked)} className="size-5" /> New siding
        </label>
      </div>
      {showRoof && (
        <>
          <Group title="Roof style" list={props.roofStyles} value={roofStyle} set={setRoofStyle} dots={false} />
          <Group title="Roof color" list={props.roofColors} value={roofColor} set={setRoofColor} />
        </>
      )}
      {showSiding && (
        <>
          <Group title="Siding style" list={props.sidingStyles} value={sidingStyle} set={setSidingStyle} dots={false} />
          <Group title="Siding color" list={props.sidingColors} value={sidingColor} set={setSidingColor} />
          <Group title="Trim" list={props.trims} value={trim} set={setTrim} />
        </>
      )}
      {state?.problems.length ? <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">{state.problems.join(" ")}</p> : null}
      {!props.enabled && <p className="rounded-lg bg-btr-blue-soft p-3 text-sm">Save the colors you like — your consultant will see your picks and bring renderings and real samples to the inspection.</p>}
      <button disabled={pending || props.left <= 0 || (!roofColor && !sidingColor)} className="rounded-lg bg-btr-blue px-4 py-3 text-base font-semibold text-white disabled:opacity-60">
        {props.left <= 0 ? "That's the limit online — your consultant can show more" : !props.enabled ? (pending ? "Saving…" : "Save this look for my consultant") : pending ? "Creating your rendering… (about 30 seconds)" : "Show me this look"}
      </button>
      {props.left > 0 && <p className="text-xs text-muted-foreground">Pick at least a roof or siding color.{props.enabled ? ` ${props.left} renderings left online.` : ""}</p>}
    </form>
  );
}
