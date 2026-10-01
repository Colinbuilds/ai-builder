"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveSettings } from "@/lib/settings";
import { syncAbc } from "@/lib/integrations/abc";
import { disconnect, isOAuthProvider } from "@/lib/integrations/oauth";

export type CResult = { ok: boolean; message: string } | null;

export async function syncAbcAction(): Promise<CResult> {
  await requireUser(["ADMIN", "OFFICE", "PURCHASING"]);
  try {
    const r = await syncAbc();
    revalidatePath("/connections");
    return { ok: true, message: `Pulled ${r.orders} orders and ${r.invoices} invoices.${r.note ? ` ${r.note}` : ""}` };
  } catch (e) {
    revalidatePath("/connections");
    return { ok: false, message: e instanceof Error ? e.message : "Sync failed." };
  }
}

export async function disconnectAction(f: FormData) {
  const u = await requireUser(["ADMIN"]);
  const p = String(f.get("provider"));
  if (!isOAuthProvider(p)) return;
  await disconnect(p, u.id);
  await prisma.auditLog.create({ data: { userId: u.id, entity: "Integration", entityId: p, action: "disconnect" } });
  revalidatePath("/connections");
}

export async function abcAccountAction(f: FormData) {
  const u = await requireUser(["ADMIN"]);
  await saveSettings({ abcBillTo: String(f.get("billTo") ?? "").trim() || null }, u);
  revalidatePath("/connections");
}
