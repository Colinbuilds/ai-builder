import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ChatPanel } from "@/components/comms/chat-panel";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const people = await prisma.user.findMany({ where: { id: { not: user.id } }, select: { name: true }, orderBy: { name: "asc" } });
  return (
    <div className="flex max-w-3xl flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Internal to BTR. Customers never see this. @mention someone to flag it for them.
      </p>
      <ChatPanel projectId={id} me={user.id} people={people.map((p) => p.name)} />
    </div>
  );
}
