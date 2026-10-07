"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { importPlanBook, PlanBookError, saveTakeoffEdit } from "@/lib/builders/planbook";
import { createHouseJob } from "@/lib/builders/house";
import type { Selection } from "@/lib/builders/plans";

const back = (bid: string, path: string, msg: string) => redirect(`/builders/${bid}/plans${path}${path.includes("?") ? "&" : "?"}err=${encodeURIComponent(msg)}`);

export async function importPlanBookAction(form: FormData) {
  const user = await requireUser(STAFF_ROLES);
  const bid = String(form.get("bid"));
  const file = form.get("file");
  let done: string;
  try {
    const bytes = file instanceof File && file.size > 0 ? new Uint8Array(await file.arrayBuffer()) : undefined;
    if (file instanceof File && file.size > 30 * 1024 * 1024) throw new PlanBookError("That file is over 30 MB.");
    const { data } = await importPlanBook(bid, { bytes, link: String(form.get("link") ?? ""), label: String(form.get("label") ?? ""), fileName: file instanceof File && file.size ? file.name : undefined }, user);
    done = `${data.plans.length} models loaded`;
  } catch (e) {
    return back(bid, "", e instanceof Error ? e.message : String(e));
  }
  revalidatePath(`/builders/${bid}/plans`);
  redirect(`/builders/${bid}/plans?ok=${encodeURIComponent(done)}`);
}

/** "Add this house": a job sold to the builder at the plan book price, with its costs planned, on the schedule. */
export async function addHouseAction(form: FormData) {
  const user = await requireUser(STAFF_ROLES);
  const bid = String(form.get("bid"));
  const book = String(form.get("book"));
  const plan = String(form.get("plan"));
  const sel: Selection = { elevation: String(form.get("e")), garage: form.get("g") === "3" ? "3" : "2", basement: form.get("b") === "DLWO" ? "DLWO" : "STANDARD", porch: form.get("p") === "1" };
  const qs = `/${encodeURIComponent(plan)}?book=${book}&e=${encodeURIComponent(sel.elevation)}&g=${sel.garage}&b=${sel.basement}&p=${sel.porch ? 1 : 0}&t=schedule`;
  const s = (k: string) => String(form.get(k) ?? "").trim() || null;
  let projectId: string;
  try {
    const trades = form.getAll("trade").map(String).filter((t): t is "ROOFING" | "GUTTERS" => t === "ROOFING" || t === "GUTTERS");
    ({ project: { id: projectId } } = await createHouseJob(book, plan, sel, { lot: s("lot"), subdivision: s("subdivision"), address: s("address") ?? "", city: s("city"), permit: s("permit"), trades, crew: s("crew"), superName: s("super"), vpo: s("po"), notes: s("notes"), color: s("color"), startId: s("startId"), startDate: s("startDate") ? new Date(`${s("startDate")}T12:00:00Z`) : null }, user));
  } catch (e) {
    return back(bid, qs, e instanceof Error ? e.message : String(e));
  }
  revalidatePath("/production");
  redirect(`/projects/${projectId}/house?ok=${encodeURIComponent("House added: it's a job now, sold to the builder, and on the production schedule (ADD board).")}`);
}

export async function saveTakeoffAction(form: FormData) {
  const user = await requireUser();
  const bid = String(form.get("bid"));
  const back2 = String(form.get("back") ?? "");
  const names = form.getAll("name").map(String);
  const qtys = form.getAll("qty").map(String);
  const lines = names.map((name, i) => ({ name, qty: qtys[i]?.trim() === "" ? 0 : Number(qtys[i]) })).filter((l) => l.name.trim());
  if (lines.some((l) => !Number.isFinite(l.qty) || l.qty < 0)) return back(bid, back2, "Quantities must be numbers, 0 or more (0 removes the line).");
  const sq = String(form.get("squares") ?? "").trim();
  let msg: string;
  try {
    const r = await saveTakeoffEdit(String(form.get("book")), String(form.get("plan")), form.get("trade") === "GUTTERS" ? "GUTTERS" : "ROOFING", String(form.get("option")), lines, sq ? Number(sq) : null, user);
    msg = r.changes.length ? `Saved: ${r.changes.join("; ")}${r.unpriced.length ? ` — not on the sheet's price list, so no price: ${r.unpriced.join(", ")}` : ""}` : "No changes.";
  } catch (e) {
    return back(bid, back2, e instanceof Error ? e.message : String(e));
  }
  revalidatePath(`/builders/${bid}/plans`, "layout");
  redirect(`/builders/${bid}/plans${back2}&saved=${encodeURIComponent(msg)}`);
}
