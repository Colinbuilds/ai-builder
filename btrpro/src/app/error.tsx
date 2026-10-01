"use client";

import { useEffect } from "react";

// Anything unexpected: say so plainly and let the person retry; details go to the server log.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-3 py-16 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground">
        Try again. If it keeps happening, send the office this code:
      </p>
      {error.digest && <p className="font-mono text-sm">{error.digest}</p>}
      <button
        onClick={reset}
        className="mx-auto rounded-md border px-4 py-2 text-sm hover:bg-muted"
      >
        Try again
      </button>
    </div>
  );
}
