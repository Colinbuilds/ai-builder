"use client";

import { useFormAction } from "@/components/use-form-action";
import { fileAction, incidentAction, talkAction, yearAction, type SafetyResult } from "@/app/safety/actions";

const input = "h-9 rounded-md border border-input bg-background px-2 text-sm";
const btn = "h-9 self-start rounded-md bg-btr-blue px-3 text-sm text-white hover:bg-btr-blue-dark disabled:opacity-60";
type Opt = { id: string; name: string };
const today = () => new Date().toISOString().slice(0, 10);

function Msg({ s, ok }: { s: SafetyResult; ok: string }) {
  if (!s) return null;
  return s.problems.length ? <p className="text-sm text-red-700">{s.problems.join(" ")}</p> : <p className="text-sm text-green-700">{ok}</p>;
}

function CrewJob({ crews, jobs }: { crews: Opt[]; jobs: Opt[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <select name="crewId" className={input} defaultValue="">
        <option value="">Crew (optional)</option>
        {crews.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select name="projectId" className={input} defaultValue="">
        <option value="">Job (optional)</option>
        {jobs.map((j) => (
          <option key={j.id} value={j.id}>
            {j.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function TalkForm({ crews, jobs, topics }: { crews: Opt[]; jobs: Opt[]; topics: string[] }) {
  const [s, act, pending] = useFormAction(talkAction, null, { resetOnOk: true });
  return (
    <form onSubmit={act} className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-[9rem_1fr]">
        <input name="date" type="date" defaultValue={today()} className={input} />
        <input name="topic" list="talk-topics" required placeholder="Topic — e.g. fall protection at roof edges" className={input} />
        <datalist id="talk-topics">
          {topics.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>
      <input name="presenter" required placeholder="Who gave it" className={input} />
      <CrewJob crews={crews} jobs={jobs} />
      <textarea name="attendees" required rows={3} placeholder="Who attended — one name per line" className="rounded-md border border-input bg-background px-2 py-1 text-sm" />
      <input name="notes" placeholder="Hazards raised / follow-ups (optional)" className={input} />
      <button disabled={pending} className={btn}>
        {pending ? "Saving…" : "Log toolbox talk"}
      </button>
      <Msg s={s} ok="Logged." />
    </form>
  );
}

export function IncidentForm({ crews, jobs, kinds }: { crews: Opt[]; jobs: Opt[]; kinds: [string, string][] }) {
  const [s, act, pending] = useFormAction(incidentAction, null, { resetOnOk: true });
  return (
    <form onSubmit={act} className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-[9rem_1fr]">
        <input name="date" type="date" defaultValue={today()} className={input} />
        <select name="kind" required className={input} defaultValue="">
          <option value="" disabled>
            What kind?
          </option>
          {kinds.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <input name="personName" placeholder="Who was hurt (if anyone)" className={input} />
      <CrewJob crews={crews} jobs={jobs} />
      <textarea name="description" required rows={2} placeholder="What happened" className="rounded-md border border-input bg-background px-2 py-1 text-sm" />
      <div className="grid grid-cols-2 gap-2">
        <input name="daysAway" inputMode="numeric" placeholder="Days away from work" className={input} />
        <input name="daysRestricted" inputMode="numeric" placeholder="Days restricted duty" className={input} />
      </div>
      <input name="correctiveAction" placeholder="What we changed so it doesn't happen again" className={input} />
      <button disabled={pending} className={btn}>
        {pending ? "Saving…" : "Log incident"}
      </button>
      <Msg s={s} ok="Logged." />
    </form>
  );
}

export function YearForm({ year, hoursWorked, avgEmployees, emr }: { year: number; hoursWorked: number | null; avgEmployees: number | null; emr: number | null }) {
  const [s, act, pending] = useFormAction(yearAction, null);
  return (
    <form onSubmit={act} className="flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="year" value={year} />
      <b className="w-12">{year}</b>
      <input name="hoursWorked" defaultValue={hoursWorked ?? ""} inputMode="numeric" placeholder="Hours worked" className={`${input} w-32`} />
      <input name="avgEmployees" defaultValue={avgEmployees ?? ""} inputMode="decimal" placeholder="Avg employees" className={`${input} w-28`} />
      <input name="emr" defaultValue={emr ?? ""} inputMode="decimal" placeholder="EMR" className={`${input} w-20`} />
      <button disabled={pending} className="h-9 rounded-md border px-3 hover:bg-muted">
        Save
      </button>
      <Msg s={s} ok="Saved." />
    </form>
  );
}

export function FileForm({ kinds }: { kinds: [string, string][] }) {
  const [s, act, pending] = useFormAction(fileAction, null, { resetOnOk: true });
  return (
    <form onSubmit={act} className="flex flex-col gap-2">
      <select name="kind" required className={input} defaultValue="">
        <option value="" disabled>
          What is it?
        </option>
        {kinds.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
      <input name="title" placeholder="Title (optional) — e.g. 2026–27 COI, Travelers" className={input} />
      <label className="flex items-center gap-2 text-sm">
        Expires
        <input name="expiresAt" type="date" className={input} />
      </label>
      <input name="file" type="file" required accept="application/pdf,image/png,image/jpeg" className="text-sm" />
      <button disabled={pending} className={btn}>
        {pending ? "Uploading…" : "Add file"}
      </button>
      <Msg s={s} ok="Added." />
    </form>
  );
}
