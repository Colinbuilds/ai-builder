import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { aiConfigured } from "@/lib/ai/claude";
import { runAssistant, type StreamEvent } from "@/lib/ai/assistant";

export const maxDuration = 300;

// Streams the assistant's answer as newline-delimited JSON events.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  if (user.role === "VIEWER") return NextResponse.json({ error: "Viewers can't use the assistant." }, { status: 403 });
  if (!aiConfigured()) return NextResponse.json({ error: "AI isn't configured (ANTHROPIC_API_KEY)." }, { status: 400 });
  const { id } = await params;
  if (!(await prisma.project.findUnique({ where: { id }, select: { id: true } }))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { message } = (await req.json().catch(() => ({}))) as { message?: string };
  if (!message?.trim()) return NextResponse.json({ error: "Empty message" }, { status: 400 });

  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const emit = (e: StreamEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        await runAssistant(id, user, message.trim().slice(0, 8000), emit);
      } catch (e) {
        emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
