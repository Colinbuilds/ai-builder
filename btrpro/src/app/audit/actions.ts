"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { auditQueue, reviewItem, type AuditEntity } from "@/lib/audit";

export type AuditResult = { problems: string[]; ok?: boolean } | null;

export async function reviewAction(_: AuditResult, f: FormData): Promise<AuditResult> {
  const owner = await requireOwner();
  const entity = String(f.get("entity")) as AuditEntity;
  const id = String(f.get("id"));
  const result = String(f.get("result")) === "FLAG" ? "FLAG" : "OK";
  const item = (await auditQueue()).find((i) => i.entity === entity && i.id === id);
  if (!item) return { problems: ["Already reviewed."] };
  try {
    await reviewItem(entity, id, result, String(f.get("note") ?? "") || null, owner, { title: item.title, projectId: item.projectId, approvedBy: item.approvedBy });
  } catch (e) {
    return { problems: [e instanceof Error ? e.message : String(e)] };
  }
  revalidatePath("/audit");
  return { problems: [], ok: true };
}
