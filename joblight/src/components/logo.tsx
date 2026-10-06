// The Joblight mark: a lit window in a work light.
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <rect x="2" y="2" width="20" height="20" rx="5" fill="var(--night)" />
        <circle cx="12" cy="12" r="5" fill="var(--light)" />
        <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2" stroke="var(--light)" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      Joblight
    </span>
  );
}
