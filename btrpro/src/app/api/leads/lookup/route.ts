import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normEmail, phoneKey } from "@/lib/customers";
import { streetKeys } from "@/lib/receipts/check";

// While a lead is typed in: has this phone, email or address been a customer before? (warranty, repeat, duplicate)
export async function GET(req: Request) {
  if (!(await getCurrentUser())) return NextResponse.json({ hits: [] }, { status: 401 });
  const u = new URL(req.url);
  const pk = phoneKey(u.searchParams.get("phone"));
  const email = normEmail(u.searchParams.get("email"));
  const addr = (u.searchParams.get("address") ?? "").trim();
  const keys = addr.length >= 6 ? streetKeys(addr) : [];
  if (!pk && !email && !keys.length) return NextResponse.json({ hits: [] });
  const contacts = pk || email
    ? await prisma.contact.findMany({
        where: { OR: [...(pk ? [{ phoneKey: pk }] : []), ...(email ? [{ email }] : [])] },
        select: { firstName: true, lastName: true, projects: { select: { project: { select: { id: true, name: true, status: true, address: true, contractAmount: true, updatedAt: true } } } } },
        take: 5,
      })
    : [];
  const byPerson = contacts.flatMap((c) => c.projects.map((p) => ({ ...p.project, why: `${c.firstName} ${c.lastName}` })));
  let byAddress: typeof byPerson = [];
  if (keys.length) {
    const jobs = await prisma.project.findMany({ where: { address: { not: null } }, select: { id: true, name: true, status: true, address: true, contractAmount: true, updatedAt: true }, take: 5000 });
    byAddress = jobs.filter((j) => streetKeys(j.address).some((k) => keys.includes(k))).map((j) => ({ ...j, why: "same address" }));
  }
  const seen = new Set<string>();
  const hits = [...byPerson, ...byAddress]
    .filter((h) => !seen.has(h.id) && seen.add(h.id))
    .slice(0, 6)
    .map((h) => ({ id: h.id, name: h.name, status: h.status, address: h.address, amount: h.contractAmount, year: h.updatedAt.getFullYear(), why: h.why }));
  if (contacts.length && !hits.length) return NextResponse.json({ hits: [], contact: `${contacts[0].firstName} ${contacts[0].lastName}` });
  return NextResponse.json({ hits });
}
