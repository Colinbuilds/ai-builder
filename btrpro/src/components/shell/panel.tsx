/** Dashboard/job panel: blue rule on top, light gray title bar, white body. */
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
    <section id={id} className={`scroll-mt-28 border-t-2 border-t-[#3b7bc8] bg-background shadow-sm ${className}`}>
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 bg-[#f4f5f7] px-3 py-1.5 dark:bg-muted">
        <h2 className="text-[17px] font-light text-foreground/85">{title}</h2>
        {right && <div className="flex items-center gap-3 text-xs">{right}</div>}
      </div>
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export const axLink = "text-[#2c62a3] hover:underline dark:text-[#7fb0ea]";
