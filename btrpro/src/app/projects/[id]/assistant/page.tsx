import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { aiConfigured } from "@/lib/ai/claude";
import { QUICK_ACTIONS } from "@/lib/ai/assistant";
import { AssistantPanel } from "@/components/assistant/assistant-panel";

export default async function AssistantPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(["ADMIN", "ESTIMATOR"]);
  const { id } = await params;
  const history = await prisma.assistantMessage.findMany({ where: { projectId: id }, orderBy: { createdAt: "asc" }, take: 100 });
  return (
    <div className="flex max-w-4xl flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Estimator assistant for this job. Prices and item numbers come only from the loaded sheets; lines it proposes wait on the
        Estimates tab as <strong>AI suggestion</strong> until someone accepts them.
      </p>
      <AssistantPanel
        projectId={id}
        enabled={aiConfigured()}
        quickActions={QUICK_ACTIONS}
        initial={history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content, tools: ((m.toolTrace as { name: string }[] | null) ?? []).map((t) => t.name) }))}
      />
    </div>
  );
}
