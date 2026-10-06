import { z } from "zod";
import { prisma } from "./db";
import { TRADES } from "./trades";

export const LeadInput = z.object({
  name: z.string().trim().min(2, "Your name").max(120),
  company: z.string().trim().min(2, "Company name").max(160),
  email: z.string().trim().toLowerCase().email("A valid email"),
  phone: z.string().trim().max(40).optional().transform((v) => v || undefined),
  trade: z.enum(TRADES.map((t) => t.key) as [string, ...string[]], { message: "Pick your trade" }),
  users: z.coerce.number().int().min(1).max(5000).optional().catch(undefined),
  message: z.string().trim().max(2000).optional().transform((v) => v || undefined),
});
export type LeadInput = z.infer<typeof LeadInput>;

export class LeadError extends Error {}

/** Saves a demo request. Max 5 per email per day (form abuse); the honeypot field must stay empty. */
export async function submitLead(raw: Record<string, unknown>, now = new Date()) {
  if (typeof raw.website === "string" && raw.website.trim()) throw new LeadError("Couldn't send that. Email us instead.");
  const r = LeadInput.safeParse(raw);
  if (!r.success) throw new LeadError(`Check: ${[...new Set(r.error.issues.map((i) => i.message))].join(", ")}.`);
  const recent = await prisma.lead.count({ where: { email: r.data.email, createdAt: { gte: new Date(now.getTime() - 86_400_000) } } });
  if (recent >= 5) throw new LeadError("We already have your request — we'll be in touch.");
  return prisma.lead.create({ data: r.data });
}
