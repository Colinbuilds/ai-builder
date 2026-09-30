import { getSettings } from "@/lib/settings";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { acculynxText, loadBundle } from "@/lib/outputs/estimate";
import { CopyButton } from "@/components/copy-button";

export default async function AccuLynxPage({
  params,
}: {
  params: Promise<{ id: string; estimateId: string }>;
}) {
  await requireUser(["ADMIN", "ESTIMATOR"]);
  const { id, estimateId } = await params;
  const cutover = (await getSettings()).acculynxCutoverDate;
  const b = await loadBundle(estimateId);
  const { text, skipped } = acculynxText(b);
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <Link
        href={`/projects/${id}/estimates/${estimateId}`}
        className="text-sm text-muted-foreground"
      >
        ← {b.e.name}
      </Link>
      <h2 className="text-xl font-semibold">AccuLynx material list</h2>
      {cutover && new Date().toISOString().slice(0, 10) > cutover && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          BTR moved off AccuLynx on {cutover}. This list is kept for reference only.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Item, quantity, unit — tab-separated so it pastes into AccuLynx columns.
        No item numbers or notes.
      </p>
      <div>
        <CopyButton text={text} label="Copy all" />
      </div>
      <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs">
        {text || "No priced material lines yet."}
      </pre>
      {skipped.length > 0 && (
        <p className="text-sm text-destructive">
          Left out because they have no quantity yet or are unaccepted AI
          suggestions: {skipped.join(", ")}
        </p>
      )}
    </div>
  );
}
