import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { STAFF_ROLES } from "@/lib/roles";
import { AREAS, hoursPerMonth, ideasForClaude, OFTEN, STATUS } from "@/lib/ideas/service";
import { CopyForClaude, IdeaForm } from "@/components/ideas/forms";
import { statusAction, voteAction } from "./actions";
import { Badge } from "@/components/ui/badge";

const TONE: Record<string, "blue" | "amber" | "green" | "default" | "outline"> = { NEW: "blue", PLANNED: "amber", BUILDING: "amber", DONE: "green", NOT_NOW: "default" };

export default async function Ideas() {
  const me = await requireUser(STAFF_ROLES);
  const ideas = await prisma.idea.findMany({ orderBy: { createdAt: "desc" } });
  const open = ideas.filter((i) => !["DONE", "NOT_NOW"].includes(i.status)).sort((a, b) => (b.votes as string[]).length - (a.votes as string[]).length);
  const closed = ideas.filter((i) => ["DONE", "NOT_NOW"].includes(i.status));
  const admin = me.role === "ADMIN";
  const Card = ({ i }: { i: (typeof ideas)[number] }) => {
    const votes = (i.votes as string[]).length;
    const mine = (i.votes as string[]).includes(me.id);
    const hrs = hoursPerMonth(i);
    return (
      <li className="flex gap-3 rounded-lg border p-3">
        <form action={voteAction} className="flex flex-col items-center">
          <input type="hidden" name="id" value={i.id} />
          <button title={mine ? "You want this — click to undo" : "I want this too"} className={`flex w-12 flex-col items-center rounded-md border px-1 py-1 text-xs ${mine ? "border-btr-blue bg-btr-blue text-white" : "hover:bg-muted"}`}>
            <span className="text-base leading-none">▲</span>
            {votes}
          </button>
        </form>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{i.title}</span>
            <Badge variant={TONE[i.status] ?? "outline"}>{STATUS[i.status as keyof typeof STATUS] ?? i.status}</Badge>
            {i.area && <span className="text-xs text-muted-foreground">{i.area}</span>}
          </div>
          <p className="mt-1 text-sm whitespace-pre-line">{i.details}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {i.createdBy} · {i.createdAt.toLocaleDateString("en-US")} · {OFTEN[i.often as keyof typeof OFTEN] ?? i.often}
            {i.minutes ? ` · ~${i.minutes} min each time` : ""}
            {hrs ? ` · about ${hrs} hrs/month back` : ""}
          </p>
          {i.reply && <p className="mt-2 rounded-md bg-muted px-2 py-1 text-sm">↳ {i.reply}</p>}
          {admin && (
            <form action={statusAction} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <input type="hidden" name="id" value={i.id} />
              <select name="status" defaultValue={i.status} className="h-8 rounded-md border border-input bg-background px-2">
                {Object.entries(STATUS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              <input name="reply" defaultValue={i.reply ?? ""} placeholder="Reply to the team (optional)" className="h-8 min-w-[14rem] flex-1 rounded-md border border-input bg-background px-2" />
              <button className="h-8 rounded-md border px-3 hover:bg-muted">Save</button>
            </form>
          )}
        </div>
      </li>
    );
  };
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Ideas board</h1>
          <p className="text-sm text-muted-foreground">
            What slows you down? Anything you do by hand, copy twice, or chase down. Add it here — vote ▲ on ideas you want too. The most-wanted get built first.
          </p>
        </div>
        {admin && <CopyForClaude text={await ideasForClaude()} />}
      </div>
      <IdeaForm areas={AREAS} often={Object.entries(OFTEN)} />
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Open ideas ({open.length})</h2>
        {open.length ? <ul className="flex flex-col gap-2">{open.map((i) => <Card key={i.id} i={i} />)}</ul> : <p className="text-sm text-muted-foreground">No ideas yet — be the first.</p>}
      </section>
      {closed.length > 0 && (
        <details>
          <summary className="cursor-pointer font-semibold">Done and parked ({closed.length})</summary>
          <ul className="mt-2 flex flex-col gap-2">{closed.map((i) => <Card key={i.id} i={i} />)}</ul>
        </details>
      )}
    </div>
  );
}
