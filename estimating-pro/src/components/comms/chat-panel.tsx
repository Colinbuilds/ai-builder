"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { postMessageAction, editMessageAction } from "@/app/projects/comms-actions";
import { useFormAction } from "@/components/use-form-action";
import { Button } from "@/components/ui/button";

type Msg = {
  id: string;
  body: string;
  authorId: string;
  author: string;
  createdAt: string;
  editedAt: string | null;
  parent: { id: string; author: string; body: string } | null;
  mentionsMe: boolean;
};

const POLL_MS = 5000;
const time = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

export function ChatPanel({ projectId, me, people }: { projectId: string; me: string; people: string[] }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const since = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const q = since.current ? `?after=${encodeURIComponent(since.current)}` : "";
    const res = await fetch(`/api/projects/${projectId}/chat${q}`, { cache: "no-store" });
    if (!res.ok) return;
    const data: { now: string; messages: Msg[] } = await res.json();
    since.current = data.now;
    if (!data.messages.length) return;
    setMsgs((cur) => {
      const byId = new Map(cur.map((m) => [m.id, m]));
      for (const m of data.messages) byId.set(m.id, m);
      return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
    setTimeout(() => bottom.current?.scrollIntoView({ block: "end" }), 0);
  }, [projectId]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const [state, send, pending] = useFormAction(async (s: Parameters<typeof postMessageAction>[0], f: FormData) => {
    const r = await postMessageAction(s, f);
    if (r?.ok) {
      setDraft("");
      setReplyTo(null);
      await load();
    }
    return r;
  }, null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-h-[60vh] min-h-64 flex-col gap-3 overflow-y-auto rounded-md border p-3">
        {msgs.length === 0 && <p className="m-auto text-sm text-muted-foreground">No messages yet. Keep job talk here instead of email.</p>}
        {msgs.map((m) => (
          <div key={m.id} id={`msg-${m.id}`} className={`rounded-md p-2 text-sm ${m.mentionsMe ? "bg-amber-50 dark:bg-amber-950" : ""}`}>
            <div className="flex items-baseline gap-2">
              <span className="font-medium">{m.author}</span>
              <span className="text-xs text-muted-foreground">
                {time(m.createdAt)}
                {m.editedAt && " (edited)"}
              </span>
              <button className="text-xs text-muted-foreground hover:underline" onClick={() => setReplyTo(m)}>
                Reply
              </button>
              {m.authorId === me && editing !== m.id && (
                <button className="text-xs text-muted-foreground hover:underline" onClick={() => setEditing(m.id)}>
                  Edit
                </button>
              )}
            </div>
            {m.parent && (
              <a href={`#msg-${m.parent.id}`} className="my-1 block border-l-2 pl-2 text-xs text-muted-foreground">
                {m.parent.author}: {m.parent.body}
              </a>
            )}
            {editing === m.id ? (
              <EditBox
                initial={m.body}
                onCancel={() => setEditing(null)}
                onSave={async (body) => {
                  const err = await editMessageAction(m.id, body);
                  if (!err) {
                    setEditing(null);
                    await load();
                  }
                  return err;
                }}
              />
            ) : (
              <p className="whitespace-pre-wrap">{m.body}</p>
            )}
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form onSubmit={send} className="flex flex-col gap-2">
        <input type="hidden" name="projectId" value={projectId} />
        {replyTo && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            Replying to {replyTo.author}: {replyTo.body.slice(0, 80)}
            <input type="hidden" name="parentId" value={replyTo.id} />
            <button type="button" className="underline" onClick={() => setReplyTo(null)}>
              cancel
            </button>
          </div>
        )}
        <textarea
          name="body"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
          }}
          rows={3}
          placeholder={`Message the team. @mention: ${people.slice(0, 3).map((p) => `@${p.split(" ")[0]}`).join(", ")}…  (Ctrl+Enter sends)`}
          className="w-full rounded-md border border-input bg-background p-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={pending || !draft.trim()}>
            {pending ? "Sending…" : "Send"}
          </Button>
          {state?.problems.map((p) => (
            <span key={p} className="text-sm text-destructive">
              {p}
            </span>
          ))}
        </div>
      </form>
    </div>
  );
}

function EditBox({ initial, onSave, onCancel }: { initial: string; onSave: (b: string) => Promise<string | null>; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mt-1 flex flex-col gap-1">
      <textarea value={v} onChange={(e) => setV(e.target.value)} rows={2} className="rounded-md border border-input bg-background p-2 text-sm" />
      <div className="flex gap-2">
        <Button size="sm" onClick={async () => setErr(await onSave(v))}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {err && <span className="text-sm text-destructive">{err}</span>}
      </div>
    </div>
  );
}
