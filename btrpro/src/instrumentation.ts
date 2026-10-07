// Runs once when the server starts (Next.js instrumentation hook).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    // load the white-label company profile so sync labels (companySync) are right from the first request
    const { getCompany } = await import("@/lib/company-profile");
    await getCompany().catch(() => null);
    const { startSheetWatcher } = await import("@/lib/sheets/drive-sync");
    startSheetWatcher();
    const { startEstimatingWatcher } = await import("@/lib/estimating/schedule");
    startEstimatingWatcher();
    const { startProductionWatcher } = await import("@/lib/production/board");
    startProductionWatcher();
    const { startAbcWatcher } = await import("@/lib/integrations/abc");
    startAbcWatcher();
    const { startDriveImportWorker } = await import("@/lib/import/drive-jobs");
    startDriveImportWorker();
    const { startBidWatcher } = await import("@/lib/bids/service");
    startBidWatcher();
    const { startBillingWatcher } = await import("@/lib/billing/schedule");
    startBillingWatcher();
    const { startBuilderWatcher } = await import("@/lib/builders/watch");
    startBuilderWatcher();
    const { startBackupWatcher } = await import("@/lib/backup");
    startBackupWatcher();
    // receipts that were mid-read when the server restarted (a deploy) are read again
    const { resumeStuckReads } = await import("@/lib/receipts/service");
    void resumeStuckReads().catch((e) => console.error("resume receipt reads failed", e));
  }
}
