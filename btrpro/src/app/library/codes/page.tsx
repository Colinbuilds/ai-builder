import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { STAFF_ROLES } from "@/lib/roles";
import { ADOPTIONS, REFERENCES, isOfficial, type Ref } from "@/lib/codes/library";
import type { WebSource } from "@/lib/ai/claude";
import { AskForm } from "@/components/codes/ask-form";
import { Markdown } from "@/components/markdown";
import { addLinkAction, removeLinkAction } from "./actions";

const KIND: Record<Ref["kind"], string> = { CODE: "Codes in force", MANUFACTURER: "Manufacturer instructions & specs", STANDARD: "Standards & design data", LOCAL: "Nebraska law" };
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

export default async function CodesLibrary({ searchParams }: { searchParams: Promise<{ job?: string; q?: string }> }) {
  await requireUser(STAFF_ROLES);
  const sp = await searchParams;
  const [jobs, questions, links] = await Promise.all([
    prisma.project.findMany({ where: { status: { notIn: ["LOST", "CLOSED", "PAID"] } }, select: { id: true, name: true }, orderBy: { statusChangedAt: "desc" }, take: 200 }),
    prisma.codeQuestion.findMany({ where: sp.job ? { projectId: sp.job } : {}, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.libraryLink.findMany({ orderBy: { createdAt: "desc" } }),
  ]);
  const jobName = new Map(jobs.map((j) => [j.id, j.name]));
  const refs: (Ref & { id?: string })[] = [...REFERENCES, ...links.map((l) => ({ ...l, kind: l.kind as Ref["kind"], jurisdiction: l.jurisdiction ?? undefined, note: l.note ?? undefined }))];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Code & spec library</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Ask BTRbot a code, spec or manufacturer question. It searches the live web — code text, the city, standards bodies and the manufacturer&apos;s current instructions — and the job&apos;s own spec book,
          answers for the edition your jurisdiction actually enforces, and lists every source. Anything it can&apos;t verify is marked unverified.
        </p>
      </div>

      <section className="rounded-lg border bg-background p-4">
        <AskForm jobs={jobs} job={sp.job} />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">
            Answers {sp.job && jobName.get(sp.job) ? `for ${jobName.get(sp.job)}` : ""}{" "}
            {sp.job && (
              <Link href="/library/codes" className="ml-2 text-xs font-normal text-btr-link hover:underline">
                show all
              </Link>
            )}
          </h2>
          {questions.map((q) => {
            const sources = q.sources as WebSource[];
            return (
              <article key={q.id} id={`q-${q.id}`} className={`rounded-lg border bg-background p-3 ${sp.q === q.id ? "ring-2 ring-btr-blue" : ""}`}>
                <div className="text-xs text-muted-foreground">
                  {q.createdBy} · {q.createdAt.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {q.jurisdiction}
                  {q.projectId && jobName.get(q.projectId) && (
                    <>
                      {" "}
                      ·{" "}
                      <Link href={`/projects/${q.projectId}`} className="text-btr-link hover:underline">
                        {jobName.get(q.projectId)}
                      </Link>
                    </>
                  )}
                  {q.officialOnly && " · official sources only"}
                </div>
                <h3 className="mt-1 font-medium">{q.question}</h3>
                <div className="prose-sm mt-2 text-sm">
                  <Markdown text={q.answer} />
                </div>
                {sources.length > 0 && (
                  <details className="mt-2 text-xs" open={sp.q === q.id}>
                    <summary className="cursor-pointer text-muted-foreground">{sources.length} sources</summary>
                    <ul className="mt-1 flex flex-col gap-1">
                      {sources.map((s) => (
                        <li key={s.url}>
                          <span className={`mr-1 rounded px-1 ${isOfficial(s.url) ? "bg-green-100 text-green-800" : "bg-muted text-muted-foreground"}`}>{isOfficial(s.url) ? "official" : "other"}</span>
                          <a href={s.url} target="_blank" rel="noreferrer" className="text-btr-link hover:underline">
                            {s.title ?? host(s.url)}
                          </a>{" "}
                          <span className="text-muted-foreground">{host(s.url)}</span>
                          {s.cited && <div className="pl-14 text-muted-foreground italic">&ldquo;{s.cited.slice(0, 220)}&rdquo;</div>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </article>
            );
          })}
          {!questions.length && <p className="text-sm text-muted-foreground">No questions yet. Ask the first one above.</p>}
        </section>

        <aside className="flex flex-col gap-4 text-sm">
          <section className="rounded-lg border bg-background p-3">
            <h2 className="font-semibold">Code editions in force</h2>
            {ADOPTIONS.map((a) => (
              <div key={a.jurisdiction} className="mt-1">
                <b>{a.jurisdiction}</b>: {a.codes}{" "}
                <a href={a.source} target="_blank" rel="noreferrer" className="text-xs text-btr-link hover:underline">
                  source
                </a>
              </div>
            ))}
            <p className="mt-1 text-xs text-muted-foreground">Other towns (Lincoln, Papillion, Council Bluffs, Douglas/Sarpy County) can adopt different editions — ask BTRbot with that jurisdiction.</p>
          </section>
          {(Object.keys(KIND) as Ref["kind"][]).map((k) => (
            <section key={k} className="rounded-lg border bg-background p-3">
              <h2 className="font-semibold">{KIND[k]}</h2>
              <ul className="mt-1 flex flex-col gap-1">
                {refs
                  .filter((r) => r.kind === k)
                  .map((r) => (
                    <li key={r.url} className="flex items-start justify-between gap-2">
                      <span>
                        <a href={r.url} target="_blank" rel="noreferrer" className="text-btr-link hover:underline">
                          {r.title}
                        </a>
                        {r.note && <span className="block text-xs text-muted-foreground">{r.note}</span>}
                      </span>
                      {r.id && (
                        <form action={removeLinkAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <button className="text-xs text-muted-foreground hover:underline">remove</button>
                        </form>
                      )}
                    </li>
                  ))}
              </ul>
            </section>
          ))}
          <form action={addLinkAction} className="flex flex-col gap-2 rounded-lg border bg-background p-3">
            <h2 className="font-semibold">Add a link</h2>
            <select name="kind" className="h-8 rounded-md border border-input bg-background px-1">
              {(Object.keys(KIND) as Ref["kind"][]).map((k) => (
                <option key={k} value={k}>
                  {KIND[k]}
                </option>
              ))}
            </select>
            <input name="title" required placeholder="Title (e.g. Elevate TPO detail manual)" className="h-8 rounded-md border border-input bg-background px-2" />
            <input name="url" required placeholder="https://…" className="h-8 rounded-md border border-input bg-background px-2" />
            <button className="h-8 self-start rounded-md border px-3 hover:bg-muted">Add</button>
          </form>
        </aside>
      </div>
    </div>
  );
}
