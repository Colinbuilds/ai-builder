import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { materialListText, loadBundle } from "@/lib/outputs/estimate";
import { CopyButton } from "@/components/copy-button";

export default async function MaterialListPage({
  params,
}: {
  params: Promise<{ id: string; estimateId: string }>;
}) {
  await requireUser(["ADMIN", "ESTIMATOR"]);
  const { id, estimateId } = await params;
  const b = await loadBundle(estimateId);
  const { text, skipped } = materialListText(b);
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <Link
        href={`/projects/${id}/estimates/${estimateId}`}
        className="text-sm text-muted-foreground"
      >
        ← {b.e.name}
      </Link>
      <h2 className="text-xl font-semibold">Material list</h2>
      <p className="text-sm text-muted-foreground">
        Item, quantity, unit — tab-separated, for texting or pasting into a supplier order.
        No item numbers or notes. For the supplier order form with item numbers, use Order CSV or the Orders tab.
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
