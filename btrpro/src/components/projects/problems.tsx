export function Problems({ state, className }: { state: { problems: string[] } | null; className?: string }) {
  if (!state?.problems.length) return null;
  return (
    <ul className={`list-disc rounded-md border border-red-300 bg-red-50 py-2 pr-3 pl-7 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200 ${className ?? ""}`}>
      {state.problems.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  );
}
