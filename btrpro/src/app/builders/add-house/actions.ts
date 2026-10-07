"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { aiErrorMessage } from "@/lib/ai/claude";
import { dismissStart, readStartSheet, startView, StartError } from "@/lib/builders/starts";
import { createHouseJob } from "@/lib/builders/house";
import { PlanBookError } from "@/lib/builders/planbook";

const err = (path: string, e: unknown) => redirect(`${path}${path.includes("?") ? "&" : "?"}err=${encodeURIComponent(e instanceof StartError || e instanceof PlanBookError ? e.message : aiErrorMessage(e))}`);

/** The builder's PDF(s): read each; one sheet goes straight to its "Yes, add it" screen. */
export async function readStartsAction(form: FormData) {
  const user = await requireUser(STAFF_ROLES);
  const files = form.getAll("pdf").filter((x): x is File => x instanceof File && x.size > 0);
  if (!files.length) err("/builders/add-house", new StartError("Choose the builder's PDF first."));
  const ids: string[] = [];
  try {
    for (const f of files.slice(0, 20)) ids.push((await readStartSheet({ bytes: new Uint8Array(await f.arrayBuffer()), name: f.name }, user)).start.id);
  } catch (e) {
    err("/builders/add-house", e);
  }
  revalidatePath("/builders/add-house");
  redirect(ids.length === 1 ? `/builders/add-house/${ids[0]}` : `/builders/add-house?read=${ids.length}`);
}

/** "Yes — add this house" on a read start sheet. */
export async function addStartAction(form: FormData) {
  const user = await requireUser(STAFF_ROLES);
  const id = String(form.get("id"));
  let projectId = "";
  try {
    const v = await startView(id);
    if (!v || !v.book || !v.plan) throw new StartError("Pick the model first (Change something).");
    const d = v.data;
    ({ project: { id: projectId } } = await createHouseJob(
      v.book.id,
      v.plan.name,
      v.sel,
      { lot: d.lot, subdivision: d.subdivision, address: d.address ?? "", city: d.city, permit: d.permit, trades: form.getAll("trade").map(String).filter((t): t is "ROOFING" | "GUTTERS" => t === "ROOFING" || t === "GUTTERS"), color: v.color, notes: d.swing ? `Garage swing ${d.swing}` : null, startId: id },
      user,
    ));
  } catch (e) {
    err(`/builders/add-house/${id}`, e);
  }
  revalidatePath("/production");
  redirect(`/projects/${projectId}/house?ok=${encodeURIComponent("House added: it's a job now, sold to the builder, and on the production schedule (ADD board).")}`);
}

export async function dismissStartAction(form: FormData) {
  await requireUser(STAFF_ROLES);
  await dismissStart(String(form.get("id")));
  revalidatePath("/builders/add-house");
  redirect("/builders/add-house");
}
