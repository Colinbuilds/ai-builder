"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

// Company rules: Admin-only edits, every change audit-logged (BUILD_PROMPT §7).
export async function saveRuleAction(f: FormData) {
  const admin = await requireUser(["ADMIN"]);
  const id = String(f.get("id"));
  const before = await prisma.rule.findUniqueOrThrow({ where: { id } });
  const text = String(f.get("text") ?? "").trim();
  const active = f.get("active") === "on";
  if (!text) return;
  const after = await prisma.rule.update({ where: { id }, data: { text, active } });
  await prisma.auditLog.create({
    data: { userId: admin.id, entity: "Rule", entityId: id, action: "update", before: { text: before.text, active: before.active }, after: { text: after.text, active: after.active } },
  });
  revalidatePath("/settings/rules");
}
