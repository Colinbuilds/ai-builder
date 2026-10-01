// Runs once when the server starts (Next.js instrumentation hook).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    const { startSheetWatcher } = await import("@/lib/sheets/drive-sync");
    startSheetWatcher();
  }
}
