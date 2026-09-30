"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { editMessage, postMessage } from "@/lib/comms/chat";
import { ingestEmail } from "@/lib/comms/email";
import { searchMailbox, type Provider } from "@/lib/comms/mailbox";
import { catchUp, summarizeEmail } from "@/lib/comms/summaries";
import { aiConfigured, aiErrorMessage } from "@/lib/ai/claude";

export type CommsResult = {
  problems: string[];
  ok?: boolean;
  note?: string;
} | null;
const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

// Everyone signed in (including Viewers) can post in job chat.
export async function postMessageAction(
  _: CommsResult,
  f: FormData,
): Promise<CommsResult> {
  const user = await requireUser();
  const projectId = String(f.get("projectId"));
  try {
    await postMessage(
      projectId,
      user.id,
      String(f.get("body") ?? ""),
      str(f, "parentId"),
    );
  } catch (e) {
    return { problems: [e instanceof Error ? e.message : String(e)] };
  }
  return { problems: [], ok: true };
}

export async function editMessageAction(
  id: string,
  body: string,
): Promise<string | null> {
  const user = await requireUser();
  try {
    await editMessage(id, user.id, body);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function summarizeQuietly(ids: string[]) {
  if (!aiConfigured()) return 0;
  const r = await Promise.allSettled(ids.map((id) => summarizeEmail(id)));
  return r.filter((x) => x.status === "fulfilled").length;
}

export async function pasteEmailAction(
  _: CommsResult,
  f: FormData,
): Promise<CommsResult> {
  const user = await requireUser(["ADMIN", "ESTIMATOR"]);
  const projectId = String(f.get("projectId"));
  const sent = str(f, "sentAt")
    ? new Date(String(f.get("sentAt")))
    : new Date();
  try {
    const e = await ingestEmail(
      projectId,
      "MANUAL",
      {
        externalId: null,
        threadId: null,
        from: str(f, "from") ?? "",
        to: str(f, "to"),
        subject: str(f, "subject") ?? "",
        sentAt: sent,
        bodyText: str(f, "body") ?? "",
        attachments: [],
      },
      user.id,
    );
    if (e) await summarizeQuietly([e.id]);
  } catch (e) {
    return { problems: [e instanceof Error ? e.message : String(e)] };
  }
  revalidatePath(`/projects/${projectId}/email`);
  return { problems: [], ok: true };
}

export async function pullMailboxAction(
  _: CommsResult,
  f: FormData,
): Promise<CommsResult> {
  const user = await requireUser(["ADMIN", "ESTIMATOR"]);
  const projectId = String(f.get("projectId"));
  const provider = String(f.get("provider")) as Provider;
  const query = str(f, "query");
  if (!query) return { problems: ["Enter what to search for."] };
  await prisma.project.update({
    where: { id: projectId },
    data: { mailQuery: query },
  });
  let found = 0;
  const added: string[] = [];
  try {
    const msgs = await searchMailbox(user.id, provider, query);
    found = msgs.length;
    for (const m of msgs) {
      const e = await ingestEmail(projectId, "GMAIL", m, user.id).catch(
        () => null,
      );
      if (e) added.push(e.id);
    }
  } catch (e) {
    return { problems: [e instanceof Error ? e.message : String(e)] };
  }
  await summarizeQuietly(added);
  revalidatePath(`/projects/${projectId}/email`);
  return {
    problems: [],
    ok: true,
    note: `Found ${found} message${found === 1 ? "" : "s"}; ${added.length} new on this job.`,
  };
}

export async function summarizeEmailAction(f: FormData) {
  await requireUser(["ADMIN", "ESTIMATOR"]);
  const id = String(f.get("id"));
  const e = await prisma.jobEmail.findUniqueOrThrow({ where: { id } });
  try {
    await summarizeEmail(id);
  } catch (err) {
    console.error("summary failed", aiErrorMessage(err));
  }
  revalidatePath(`/projects/${e.projectId}/email`);
}

export async function catchUpAction(
  _: CommsResult,
  f: FormData,
): Promise<CommsResult> {
  const user = await requireUser();
  const projectId = String(f.get("projectId"));
  const mode = f.get("mode") === "all" ? "all" : "since_last";
  try {
    await catchUp(projectId, user, mode);
  } catch (e) {
    return { problems: [aiErrorMessage(e)] };
  }
  revalidatePath(`/projects/${projectId}`);
  return { problems: [], ok: true };
}

export async function disconnectMailboxAction(f: FormData) {
  const user = await requireUser();
  await prisma.mailboxConnection.deleteMany({
    where: { userId: user.id, provider: String(f.get("provider")) as Provider },
  });
  revalidatePath("/", "layout");
}
