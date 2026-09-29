import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listMessages, markChatRead } from "@/lib/comms/chat";

// Polled by the chat panel for new and edited messages.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const { id } = await params;
  const after = new URL(req.url).searchParams.get("after");
  const since = after ? new Date(after) : undefined;
  const messages = await listMessages(id, since && !Number.isNaN(since.getTime()) ? since : undefined);
  await markChatRead(id, user.id);
  return NextResponse.json({
    now: new Date().toISOString(),
    messages: messages.map((m) => ({
      id: m.id,
      body: m.body,
      authorId: m.author.id,
      author: m.author.name,
      createdAt: m.createdAt.toISOString(),
      editedAt: m.editedAt?.toISOString() ?? null,
      parent: m.parent ? { id: m.parent.id, author: m.parent.author.name, body: m.parent.body.slice(0, 140) } : null,
      mentionsMe: Array.isArray(m.mentions) && (m.mentions as string[]).includes(user.id),
    })),
  });
}
