"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { BILLING_ROLES } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { createInvoice } from "@/lib/billing/service";
import { houseName, houseOf } from "@/lib/builders/house";

/** One click: bill the builder for this house — a line per trade, at the plan book's sell. */
export async function billHouseAction(form: FormData) {
  const user = await requireUser(BILLING_ROLES);
  const id = String(form.get("id"));
  const p = await prisma.project.findUniqueOrThrow({ where: { id }, select: { builderHouse: true, invoices: { where: { status: { not: "VOID" } }, select: { subtotal: true } } } });
  const h = houseOf(p);
  if (!h) redirect(`/projects/${id}/house?t=invoice&err=${encodeURIComponent("This job isn't a builder house.")}`);
  const where = houseName(h);
  const trades = (["ROOFING", "GUTTERS"] as const).filter((t) => h.trades[t]);
  const sell = Math.round(trades.reduce((a, t) => a + h.trades[t]!.sell, 0) * 100) / 100;
  const billed = Math.round(p.invoices.reduce((a, i) => a + i.subtotal, 0) * 100) / 100;
  const left = Math.round((sell - billed) * 100) / 100;
  if (left <= 0.5) redirect(`/projects/${id}/house?t=invoice&err=${encodeURIComponent("This house is already fully invoiced.")}`);
  // nothing billed yet: a line per trade; part already billed (a draw): one line for the balance
  const lines = billed
    ? [{ description: `Balance — ${h.label} — ${where}`, amount: left }]
    : trades.map((t) => ({ description: `${t === "ROOFING" ? "Roofing" : "Gutters"} — ${h.label} — ${where}`, amount: h.trades[t]!.sell }));
  let msg: string;
  try {
    const inv = await createInvoice(id, { kind: "FINAL", lines, notes: [h.permit ? `Permit ${h.permit}` : null, `${h.builder} ${h.bookLabel} plan book`].filter(Boolean).join(" · ") }, user);
    msg = `Invoice ${inv.number} made (draft). Open Invoices & payments to send it.`;
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
    redirect(`/projects/${id}/house?t=invoice&err=${encodeURIComponent(msg)}`);
  }
  revalidatePath(`/projects/${id}`, "layout");
  redirect(`/projects/${id}/house?t=invoice&ok=${encodeURIComponent(msg)}`);
}
