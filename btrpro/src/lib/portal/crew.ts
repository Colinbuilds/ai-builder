// Crew phone link (§13 field view): a crew's own page with this week's jobs, their work orders,
// hours / piece work logging (approved in the office before it hits job costing), and delivery-ticket photos.
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { addDocument } from "@/lib/docs/documents";
import { addTimeEntry } from "@/lib/production/service";

type Actor = { id: string; name: string; role: string };
export class CrewLinkError extends Error {}
export const crewUrl = (token: string) =>
  `${process.env.APP_URL ?? ""}/c/${token}`;
const DAY = 86_400_000;

export async function shareCrewLink(
  crewId: string,
  actor: Actor,
  rotate = false,
) {
  if (actor.role === "VIEWER")
    throw new CrewLinkError("Viewers can't share crew links.");
  const c = await prisma.crew.findUniqueOrThrow({ where: { id: crewId } });
  const token =
    !rotate && c.portalToken
      ? c.portalToken
      : randomBytes(18).toString("base64url");
  if (token !== c.portalToken)
    await prisma.crew.update({
      where: { id: crewId },
      data: { portalToken: token },
    });
  return crewUrl(token);
}

export async function crewByToken(token: string) {
  if (!token) return null;
  return prisma.crew.findFirst({ where: { portalToken: token, active: true } });
}

/** Today's and the next two weeks' jobs for the crew, plus open work orders. */
export async function crewPortal(token: string, now = new Date()) {
  const crew = await crewByToken(token);
  if (!crew) return null;
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const [events, orders] = await Promise.all([
    prisma.scheduleEvent.findMany({
      where: {
        crewId: crew.id,
        status: { not: "CANCELLED" },
        endDate: { gte: start },
        startDate: { lte: new Date(start.getTime() + 14 * DAY) },
      },
      include: { project: { select: { id: true, name: true, address: true } } },
      orderBy: { startDate: "asc" },
    }),
    prisma.workOrder.findMany({
      where: { crewId: crew.id, status: { in: ["SENT", "IN_PROGRESS"] } },
      include: { project: { select: { id: true, name: true, address: true } } },
      orderBy: { startDate: "asc" },
    }),
  ]);
  const jobs = new Map<
    string,
    { id: string; name: string; address: string | null }
  >();
  for (const x of [...events, ...orders])
    if (x.project) jobs.set(x.project.id, x.project);
  const recent = await prisma.timeEntry.findMany({
    where: {
      crewId: crew.id,
      date: { gte: new Date(start.getTime() - 14 * DAY) },
    },
    include: { project: { select: { name: true } } },
    orderBy: { date: "desc" },
    take: 20,
  });
  return {
    crew,
    today: start,
    events,
    orders,
    jobs: [...jobs.values()],
    recent,
  };
}

async function crewJob(token: string, projectId: string) {
  const crew = await crewByToken(token);
  if (!crew)
    throw new CrewLinkError(
      "This crew link isn't active anymore. Call the office.",
    );
  const on =
    (await prisma.scheduleEvent.count({
      where: { crewId: crew.id, projectId, status: { not: "CANCELLED" } },
    })) +
    (await prisma.workOrder.count({
      where: { crewId: crew.id, projectId, status: { not: "CANCELLED" } },
    }));
  if (!on) throw new CrewLinkError("That job isn't assigned to your crew.");
  return crew;
}

/** Hours (hourly crews) or quantity (piece-rate crews) at the crew's rate on file; the office approves it. */
export async function logCrewWork(
  token: string,
  input: { projectId: string; date: Date; amount: number; note: string | null },
) {
  const crew = await crewJob(token, input.projectId);
  if (!Number.isFinite(input.amount) || input.amount <= 0)
    throw new CrewLinkError(
      crew.payType === "PIECE"
        ? `Enter the ${crew.rateUnit ?? "quantity"} done.`
        : "Enter the hours worked.",
    );
  const piece = crew.payType === "PIECE";
  return addTimeEntry(
    input.projectId,
    {
      crewId: crew.id,
      date: input.date,
      basis: piece ? "PIECE" : "HOURLY",
      hours: piece ? null : input.amount,
      qty: piece ? input.amount : null,
      unit: piece ? crew.rateUnit : null,
      rate: null,
      note: input.note,
    },
    { id: null, name: `${crew.name} (crew link)`, role: "ESTIMATOR" },
  );
}

/** A photo or PDF of the delivery ticket, filed on the job's Documents for the office to check against the order. */
export async function uploadDeliveryTicket(
  token: string,
  projectId: string,
  file: { bytes: Uint8Array; name: string; type: string | null },
) {
  const crew = await crewJob(token, projectId);
  if (!file.bytes.length)
    throw new CrewLinkError("Take or choose a photo of the ticket.");
  const ext = file.name.split(".").pop() ?? "jpg";
  const { doc } = await addDocument({
    projectId,
    bytes: file.bytes,
    fileName: `Delivery ticket ${new Date().toISOString().slice(0, 10)} (${crew.name}).${ext}`,
    contentType: file.type,
  });
  await prisma.projectActivity.create({
    data: {
      projectId,
      kind: "document",
      text: `${crew.name} uploaded a delivery ticket from the crew link — check it against the material order`,
    },
  });
  return doc;
}
