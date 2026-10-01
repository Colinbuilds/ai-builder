import { requireUser } from "@/lib/auth";
import { listSheets } from "@/lib/price";
import { UploadForm } from "./upload-form";

export default async function UploadPage() {
  await requireUser(["ADMIN", "PURCHASING"]);
  const sheets = await listSheets();
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Upload a price sheet</h1>
        <p className="text-sm text-muted-foreground">
          PDF (including the ZIP-container PDFs ABC sends), .txt, or a .csv in the same layout as{" "}
          <code>data/price_items.csv</code>. You&apos;ll review every row and the changes against the current version
          before anything goes live.
        </p>
      </div>
      <UploadForm sheets={sheets.map((s) => ({ code: s.code, name: s.name, isLoaded: s.isLoaded }))} />
    </div>
  );
}
