"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { ReceiptError, fileReceipt, scanReceipt } from "@/lib/receipts/service";
import { CostError } from "@/lib/costing/service";
import { aiErrorMessage } from "@/lib/ai/claude";

export type RResult = { problems: string[]; ok?: boolean; note?: string } | null;
const msg = (e: unknown) => (e instanceof ReceiptError || e instanceof CostError ? e.message : aiErrorMessage(e));

export async function scanReceiptAction(_: RResult, f: FormData): Promise<RResult> {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  let id: string;
  try {
    const files = await Promise.all(
      f
        .getAll("photos")
        .filter((x): x is File => x instanceof File && x.size > 0)
        .map(async (x) => ({ bytes: new Uint8Array(await x.arrayBuffer()), name: x.name || "receipt" })),
    );
    id = await scanReceipt(files, u);
  } catch (e) {
    return { problems: [msg(e)] };
  }
  redirect(`/receipts/${id}`);
}

export async function fileReceiptAction(_: RResult, f: FormData): Promise<RResult> {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  const id = String(f.get("id") ?? "");
  const projectId = String(f.get("projectId") ?? "");
  if (!projectId) return { problems: ["Pick the job this receipt is for."] };
  try {
    const r = await fileReceipt(id, projectId, { id: u.id, name: u.name, role: u.role });
    revalidatePath(`/receipts/${id}`);
    revalidatePath(`/projects/${projectId}/costs`);
    return { problems: [], ok: true, note: `Filed ${r.count} line${r.count === 1 ? "" : "s"} ($${r.total.toFixed(2)}) to the job's material costs${r.flagged ? ` — ${r.flagged} billed off the price sheet` : ""}.` };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}
