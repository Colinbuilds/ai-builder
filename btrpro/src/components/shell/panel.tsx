/** BTR card: white, thin grey border, bold title row. */
export function Panel({
  title,
  right,
  children,
  className = "",
  bodyClass = "p-4",
  id,
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClass?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`scroll-mt-28 overflow-hidden rounded-lg border border-btr-line bg-background ${className}`}>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-btr-line px-4 py-2">
        <h2 className="text-[15px] font-semibold tracking-tight text-btr-ink">{title}</h2>
        {right && <div className="flex items-center gap-3 text-xs">{right}</div>}
      </div>
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export const axLink = "text-btr-link hover:underline";
