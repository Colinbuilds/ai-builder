export function Health({ ok, ms, at, error }: { ok: boolean | null; ms: number | null; at: Date | null; error: string | null }) {
  if (ok == null) return <span className="text-xs text-muted">not checked</span>;
  const when = at ? at.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  return ok ? (
    <span className="text-xs text-ok">
      ● up {ms != null ? `${ms} ms` : ""} <span className="text-muted">· {when}</span>
    </span>
  ) : (
    <span className="text-xs text-bad" title={error ?? undefined}>
      ● down <span className="text-muted">· {error} · {when}</span>
    </span>
  );
}
