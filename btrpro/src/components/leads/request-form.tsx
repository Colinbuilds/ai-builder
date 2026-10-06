"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { shrinkPhoto } from "@/components/shrink-photo";
import { submitRequestAction } from "@/app/quote/actions";
import { useBrand } from "@/components/brand";

type Opts = Record<string, string>;
const field = "w-full rounded-lg border border-btr-line bg-background px-3 py-3 text-base";
const label = "flex flex-col gap-1 text-sm font-medium";
const STEPS = ["What you need", "Your property", "Photos", "How to reach you"];

export function RequestForm({ wants, propertyTypes, relationships, timelines, stories, roofNow, phone }: { wants: Opts; propertyTypes: Opts; relationships: Opts; timelines: Opts; stories: readonly string[]; roofNow: readonly string[]; phone: string }) {
  const { companyName } = useBrand();
  const [state, dispatch, pending] = useActionState(submitRequestAction, null);
  const [step, setStep] = useState(0);
  const [err, setErr] = useState("");
  const [insurance, setInsurance] = useState(false);
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const files = useRef<File[]>([]);
  const [t] = useState(() => String(Date.now()));

  // what each step needs before Next
  const check = (s: number) => {
    const f = new FormData(form.current!);
    const v = (k: string) => String(f.get(k) ?? "").trim();
    if (s === 0) {
      if (!f.getAll("wants").length) return "Pick at least one thing you'd like done.";
      if (v("description").length < 10) return "Tell us a little about what you'd like done.";
    }
    if (s === 1) {
      if (!v("street") || !v("city") || !v("zip")) return "Enter the property's street, city and ZIP.";
      if (!v("propertyType")) return "Tell us what kind of property it is.";
      if (!v("relationship")) return "Tell us whether you own, manage or rent it.";
    }
    if (s === 2 && !files.current.length) return "Add at least one photo — the front of the building is best.";
    return "";
  };
  const next = () => {
    const e = check(step);
    setErr(e);
    if (!e) {
      setStep(step + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };
  const addFiles = (list: FileList | null) => {
    const add = [...(list ?? [])].filter((x) => x.type.startsWith("image/") || /\.(heic|heif)$/i.test(x.name));
    files.current = [...files.current, ...add].slice(0, 8);
    setPreviews(files.current.map((x) => URL.createObjectURL(x)));
  };
  const remove = (i: number) => {
    files.current = files.current.filter((_, n) => n !== i);
    setPreviews(files.current.map((x) => URL.createObjectURL(x)));
  };

  return (
    <form
      ref={form}
      className="flex flex-col gap-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        f.delete("photos");
        setBusy(true);
        for (const file of files.current) f.append("photos", await shrinkPhoto(file), file.name.replace(/\.\w+$/, "") + ".jpg");
        setBusy(false);
        startTransition(() => dispatch(f));
      }}
    >
      <input type="hidden" name="t" value={t} />
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />

      <ol className="grid grid-cols-4 gap-1 text-[11px] sm:text-xs">
        {STEPS.map((s, i) => (
          <li key={s} className={`border-t-4 pt-1 ${i <= step ? "border-btr-blue font-medium" : "border-btr-line text-muted-foreground"}`}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {/* 1 — what you need */}
      <section className={step === 0 ? "flex flex-col gap-4" : "hidden"}>
        <h2 className="text-xl font-semibold">What would you like done?</h2>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(wants).map(([k, l]) => (
            <label key={k} className="flex cursor-pointer items-center gap-2 rounded-lg border border-btr-line p-3 text-base has-[:checked]:border-btr-blue has-[:checked]:bg-btr-blue-soft">
              <input type="checkbox" name="wants" value={k} className="size-5 shrink-0" />
              {l}
            </label>
          ))}
        </div>
        <label className={label}>
          Tell us about it
          <textarea name="description" rows={4} className={field} placeholder="e.g. Hail last spring, a few shingles missing on the back, and we'd like to replace the siding with something darker." />
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">When would you like it done?</legend>
          {Object.entries(timelines).map(([k, l]) => (
            <label key={k} className="flex items-center gap-2 text-base">
              <input type="radio" name="timeline" value={k} className="size-5" /> {l}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Is this an insurance claim (storm, hail or wind damage)?</legend>
          <div className="flex gap-4 text-base">
            <label className="flex items-center gap-2">
              <input type="radio" name="insurance" value="yes" className="size-5" onChange={() => setInsurance(true)} /> Yes
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="insurance" value="no" className="size-5" defaultChecked onChange={() => setInsurance(false)} /> No / not sure
            </label>
          </div>
          {insurance && (
            <div className="grid gap-2 sm:grid-cols-3">
              <input name="insuranceCarrier" placeholder="Insurance company" className={field} />
              <input name="claimNumber" placeholder="Claim # (if you have one)" className={field} />
              <label className="flex flex-col text-xs text-muted-foreground">
                Date of the storm
                <input name="dateOfLoss" type="date" className={field} />
              </label>
            </div>
          )}
        </fieldset>
      </section>

      {/* 2 — property */}
      <section className={step === 1 ? "flex flex-col gap-4" : "hidden"}>
        <h2 className="text-xl font-semibold">Where is the property?</h2>
        <label className={label}>
          Street address
          <input name="street" autoComplete="street-address" className={field} />
        </label>
        <div className="grid grid-cols-[1fr_4.5rem_6.5rem] gap-2">
          <label className={label}>
            City
            <input name="city" autoComplete="address-level2" className={field} />
          </label>
          <label className={label}>
            State
            <input name="state" defaultValue="NE" maxLength={2} autoComplete="address-level1" className={`${field} uppercase`} />
          </label>
          <label className={label}>
            ZIP
            <input name="zip" inputMode="numeric" autoComplete="postal-code" className={field} />
          </label>
        </div>
        <label className={label}>
          What kind of property?
          <select name="propertyType" defaultValue="" className={field}>
            <option value="" disabled>
              Pick one
            </option>
            {Object.entries(propertyTypes).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          You…
          <select name="relationship" defaultValue="" className={field}>
            <option value="" disabled>
              Pick one
            </option>
            {Object.entries(relationships).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className={label}>
            How tall?
            <select name="stories" defaultValue="" className={field}>
              <option value="">—</option>
              {stories.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className={label}>
            Roof today
            <select name="currentRoof" defaultValue="" className={field}>
              <option value="">—</option>
              {roofNow.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        <label className={label}>
          About how old is the roof / siding? (optional)
          <input name="roofAge" placeholder="e.g. 15 years" className={field} />
        </label>
      </section>

      {/* 3 — photos */}
      <section className={step === 2 ? "flex flex-col gap-4" : "hidden"}>
        <h2 className="text-xl font-semibold">Add photos of the property</h2>
        <p className="text-sm text-muted-foreground">
          Start with a straight-on photo of the <b>front of the building</b> from the street — that&apos;s the one we use to show you new looks. Add close-ups of any damage too. Up to 8 photos.
        </p>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-btr-line px-3 py-8 text-center text-base font-medium text-btr-link">
          <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => addFiles(e.currentTarget.files)} />
          Take or choose photos
          <span className="text-xs font-normal text-muted-foreground">{previews.length ? `${previews.length} added` : "JPG, PNG or iPhone photos"}</span>
        </label>
        {previews.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {previews.map((u, i) => (
              <div key={u} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt={`Photo ${i + 1}`} className="aspect-square w-full rounded-lg object-cover" />
                {i === 0 && <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-white">Main photo</span>}
                <button type="button" onClick={() => remove(i)} className="absolute top-1 right-1 rounded-full bg-white/90 px-2 text-sm text-black" aria-label="Remove photo">
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4 — contact */}
      <section className={step === 3 ? "flex flex-col gap-4" : "hidden"}>
        <h2 className="text-xl font-semibold">How do we reach you?</h2>
        <div className="grid grid-cols-2 gap-2">
          <label className={label}>
            First name
            <input name="firstName" autoComplete="given-name" className={field} />
          </label>
          <label className={label}>
            Last name
            <input name="lastName" autoComplete="family-name" className={field} />
          </label>
        </div>
        <label className={label}>
          Mobile phone
          <input name="phone" type="tel" inputMode="tel" autoComplete="tel" className={field} />
        </label>
        <label className={label}>
          Email
          <input name="email" type="email" autoComplete="email" className={field} />
        </label>
        <label className={label}>
          Best way to reach you
          <select name="contactPref" defaultValue="CALL" className={field}>
            <option value="CALL">Phone call</option>
            <option value="TEXT">Text</option>
            <option value="EMAIL">Email</option>
          </select>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="textOk" className="mt-0.5 size-5" /> It&apos;s OK for {companyName} to text me about this request and my appointment.
        </label>
        <label className={label}>
          Good days and times for a free inspection
          <input name="inspectionTimes" placeholder="e.g. weekday mornings, or Sat after 10" className={field} />
        </label>
        <label className={label}>
          How did you hear about us? (optional)
          <input name="heardFrom" placeholder="Google, a neighbor, yard sign…" className={field} />
        </label>
      </section>

      {(err || state?.problems.length) && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {err || state?.problems.join(" ")}
        </div>
      )}

      <div className="flex gap-2">
        {step > 0 && (
          <button type="button" onClick={() => setStep(step - 1)} className="rounded-lg border border-btr-line px-4 py-3 text-base">
            Back
          </button>
        )}
        {step < 3 ? (
          <button type="button" onClick={next} className="flex-1 rounded-lg bg-btr-blue px-4 py-3 text-base font-semibold text-white">
            Next
          </button>
        ) : (
          <button disabled={pending || busy} className="flex-1 rounded-lg bg-btr-blue px-4 py-3 text-base font-semibold text-white disabled:opacity-60">
            {busy ? "Preparing photos…" : pending ? "Sending…" : "Send my request"}
          </button>
        )}
      </div>
      <p className="text-center text-xs text-muted-foreground">Rather talk to someone? Call {phone}.</p>
    </form>
  );
}
