"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";

type Msg = { role: "user" | "assistant"; content: string; tools?: string[] };

const TOOL_LABEL: Record<string, string> = {
  search_price_items: "searching the price sheets",
  get_price_item: "checking an item",
  get_measurements: "reading measurements",
  get_intake: "reading intake",
  get_sheet_status: "checking sheet dates",
  run_calc: "running the calculator",
  propose_line_items: "proposing lines",
  list_open_items: "reading open items",
  add_open_item: "adding an open item",
  get_job_communications: "reading chat & email",
  list_documents: "listing documents",
  read_document: "reading a document",
  propose_scope: "writing scope",
};

export function AssistantPanel({
  projectId,
  initial,
  quickActions,
  enabled,
}: {
  projectId: string;
  initial: Msg[];
  quickActions: { key: string; label: string; prompt: string }[];
  enabled: boolean;
}) {
  const [msgs, setMsgs] = useState<Msg[]>(initial);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const router = useRouter();

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setDraft("");
    setMsgs((m) => [
      ...m,
      { role: "user", content: text },
      { role: "assistant", content: "", tools: [] },
    ]);
    const patch = (fn: (a: Msg) => Msg) =>
      setMsgs((m) => [...m.slice(0, -1), fn(m[m.length - 1])]);
    try {
      const res = await fetch(`/api/projects/${projectId}/assistant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok || !res.body) {
        const err = await res
          .json()
          .catch(() => ({ error: `Error ${res.status}` }));
        patch((a) => ({ ...a, content: `_${err.error}_` }));
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          const ev = JSON.parse(l) as {
            type: string;
            text?: string;
            name?: string;
            message?: string;
          };
          if (ev.type === "text")
            patch((a) => ({ ...a, content: a.content + ev.text }));
          if (ev.type === "tool")
            patch((a) => ({ ...a, tools: [...(a.tools ?? []), ev.name!] }));
          if (ev.type === "error")
            patch((a) => ({
              ...a,
              content: `${a.content}\n\n_${ev.message}_`,
            }));
        }
        bottom.current?.scrollIntoView({ block: "end" });
      }
    } finally {
      setBusy(false);
      router.refresh(); // proposed lines, open items, and scope show up on the estimate
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {quickActions.map((q) => (
          <Button
            key={q.key}
            size="sm"
            variant="outline"
            disabled={busy || !enabled}
            onClick={() => send(q.prompt)}
          >
            {q.label}
          </Button>
        ))}
      </div>
      <div className="flex max-h-[65vh] min-h-72 flex-col gap-3 overflow-y-auto rounded-md border p-3">
        {msgs.length === 0 && (
          <p className="m-auto max-w-md text-center text-sm text-muted-foreground">
            Ask about this job. The assistant reads the intake, measurements,
            price sheets, documents, and chat/email, runs the calculator, and
            proposes lines for you to accept. It never invents prices or
            measurements.
          </p>
        )}
        {msgs.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "self-end rounded-md bg-muted px-3 py-2 text-sm"
                : "text-sm"
            }
          >
            {m.role === "user" ? (
              <p className="whitespace-pre-wrap">{m.content}</p>
            ) : (
              <>
                {m.tools && m.tools.length > 0 && (
                  <p className="mb-1 text-xs text-muted-foreground">
                    {[...new Set(m.tools)]
                      .map((t) => TOOL_LABEL[t] ?? t)
                      .join(" · ")}
                  </p>
                )}
                {m.content ? (
                  <Markdown text={m.content} />
                ) : busy && i === msgs.length - 1 ? (
                  <p className="text-muted-foreground">Working…</p>
                ) : null}
              </>
            )}
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        className="flex gap-2"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(draft);
          }}
          rows={2}
          disabled={!enabled}
          placeholder={
            enabled
              ? "Ask BTRbot — e.g. What's the coverage on the Omniridge? · Price the EPDM system per the spec · (Ctrl+Enter sends)"
              : "BTRbot isn't turned on yet (needs ANTHROPIC_API_KEY on the server)."
          }
          className="flex-1 rounded-md border border-input bg-background p-2 text-sm"
        />
        <Button disabled={busy || !enabled || !draft.trim()}>
          {busy ? "BTRbot is working…" : "Ask BTRbot"}
        </Button>
      </form>
    </div>
  );
}
