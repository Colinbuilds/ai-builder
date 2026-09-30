import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { defaultMailQuery } from "@/lib/comms/email";
import { providerConfigured } from "@/lib/comms/mailbox";
import { aiConfigured } from "@/lib/ai/claude";
import {
  summarizeEmailAction,
  disconnectMailboxAction,
} from "@/app/projects/comms-actions";
import { PasteEmail, PullMailbox } from "@/components/comms/email-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const when = (d: Date) =>
  d.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "medium",
    timeStyle: "short",
  });

export default async function EmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mail?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { mail } = await searchParams;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) notFound();
  const [emails, mailboxes] = await Promise.all([
    prisma.jobEmail.findMany({
      where: { projectId: id },
      include: { attachments: true },
      orderBy: { sentAt: "desc" },
    }),
    prisma.mailboxConnection.findMany({
      where: { userId: user.id },
      select: { provider: true, email: true },
    }),
  ]);
  const canEdit = user.role !== "VIEWER";
  const domain = process.env.INBOUND_EMAIL_DOMAIN;
  const address = `job-${project.emailToken}@${domain || "<your inbound domain>"}`;
  const ai = aiConfigured();
  const back = `/projects/${id}/email`;
  const label = { GOOGLE: "Gmail", MICROSOFT: "Microsoft 365" } as const;

  return (
    <div className="flex flex-col gap-5">
      {mail && (
        <p className="rounded-md border p-2 text-sm">
          {mail === "connected"
            ? "Mailbox connected."
            : mail === "denied"
              ? "Mailbox connection was cancelled."
              : mail}
        </p>
      )}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border p-4 text-sm">
          <h2 className="font-semibold">Forward or CC this job</h2>
          <p className="mt-1 font-mono break-all">{address}</p>
          <p className="mt-1 text-muted-foreground">
            Anything sent or CC&apos;d to this address lands here with its
            attachments. Give it to the GC, adjuster, or supplier, or BCC it on
            your own replies.
            {!domain &&
              " Set INBOUND_EMAIL_DOMAIN and point your inbound email provider's webhook at /api/inbound-email."}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-col gap-2 rounded-md border p-4 text-sm">
            <h2 className="font-semibold">Pull from your mailbox</h2>
            {mailboxes.length ? (
              <>
                <PullMailbox
                  projectId={id}
                  query={project.mailQuery ?? defaultMailQuery(project)}
                  providers={mailboxes.map((m) => ({
                    value: m.provider,
                    label: `${label[m.provider]} (${m.email})`,
                  }))}
                />
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {mailboxes.map((m) => (
                    <form key={m.provider} action={disconnectMailboxAction}>
                      <input type="hidden" name="provider" value={m.provider} />
                      {label[m.provider]}: {m.email}{" "}
                      <button className="underline">disconnect</button>
                    </form>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">
                Connect a mailbox to search it for this job&apos;s email
                (read-only).
              </p>
            )}
            <div className="flex gap-2">
              {(["GOOGLE", "MICROSOFT"] as const)
                .filter((p) => !mailboxes.some((m) => m.provider === p))
                .map((p) =>
                  providerConfigured(p) ? (
                    <Button key={p} asChild size="sm" variant="outline">
                      <a
                        href={`/api/mail/${p.toLowerCase()}/start?returnTo=${encodeURIComponent(back)}`}
                      >
                        Connect {label[p]}
                      </a>
                    </Button>
                  ) : (
                    <span key={p} className="text-xs text-muted-foreground">
                      {label[p]} connection not configured on this server.
                    </span>
                  ),
                )}
            </div>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">
          {emails.length} email{emails.length === 1 ? "" : "s"} on this job
        </h2>
        {emails.map((e) => (
          <details key={e.id} className="rounded-md border p-3 text-sm">
            <summary className="cursor-pointer">
              <span className="font-medium">{e.subject}</span>
              <span className="text-muted-foreground">
                {" "}
                · {e.fromAddr} · {when(e.sentAt)}
              </span>{" "}
              <Badge variant="outline">
                {e.source === "FORWARDED"
                  ? "forwarded"
                  : e.source === "GMAIL"
                    ? "mailbox"
                    : "pasted"}
              </Badge>
              {e.attachments.length > 0 && (
                <Badge variant="outline">
                  {e.attachments.length} attachment(s)
                </Badge>
              )}
              {e.summary && (
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                  {e.summary}
                </p>
              )}
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              {!e.summary && canEdit && ai && (
                <form action={summarizeEmailAction}>
                  <input type="hidden" name="id" value={e.id} />
                  <Button size="sm" variant="outline">
                    Summarize
                  </Button>
                </form>
              )}
              {e.attachments.length > 0 && (
                <ul className="text-xs">
                  {e.attachments.map((a) => (
                    <li key={a.id}>
                      <a href={`/api/documents/${a.id}`} className="underline">
                        {a.fileName}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <pre className="max-h-96 overflow-auto rounded bg-muted p-3 text-xs whitespace-pre-wrap">
                {e.bodyText}
              </pre>
            </div>
          </details>
        ))}
      </section>

      {canEdit && (
        <details className="rounded-md border p-4 text-sm">
          <summary className="cursor-pointer font-semibold">
            Paste an email
          </summary>
          <div className="mt-3">
            <PasteEmail projectId={id} />
          </div>
        </details>
      )}
    </div>
  );
}
