// Runs once when the server starts (Next.js instrumentation hook).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    const { startSheetWatcher } = await import("@/lib/sheets/drive-sync");
    startSheetWatcher();
    const { startEstimatingWatcher } = await import("@/lib/estimating/schedule");
    startEstimatingWatcher();
    const { startProductionWatcher } = await import("@/lib/production/board");
    startProductionWatcher();
    const { startAbcWatcher } = await import("@/lib/integrations/abc");
    startAbcWatcher();
  }
}
