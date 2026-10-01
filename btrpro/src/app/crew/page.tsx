import Link from "next/link";
import { requireCrew } from "@/lib/crew/auth";
import { crewJobs, STAGE_LABEL, REQUIRED_STAGES, PHOTO_STAGES } from "@/lib/crew/service";
import { prisma } from "@/lib/db";
import { CrewHeader } from "./crew-header";

export const metadata = { title: "BTR crew portal" };
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const STATUS: Record<string, string> = { SUBMITTED: "Waiting on the office", APPROVED: "Approved", REJECTED: "Sent back", PAID: "Paid" };

export default async function CrewHome() {
  const crew = await requireCrew();
  const [jobs, invoices, flagged] = await Promise.all([
    crewJobs(crew.id),
    prisma.crewInvoice.findMany({ where: { crewId: crew.id }, include: { project: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.jobPhoto.findMany({ where: { crewId: crew.id, review: "ISSUE" }, include: { project: { select: { id: true, name: true } } }, orderBy: { reviewedAt: "desc" }, take: 10 }),
  ]);
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <CrewHeader name={crew.name} />
      {flagged.length > 0 && (
        <section className="rounded-xl border-2 border-btr-black p-4">
          <h2 className="font-semibold">The office flagged these</h2>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {flagged.map((p) => (
              <li key={p.id}>
                <Link href={`/crew/jobs/${p.project.id}`} className="text-btr-link underline">
                  {p.project.name}
                </Link>{" "}
                — {STAGE_LABEL[p.stage as keyof typeof STAGE_LABEL]}: {p.reviewNote}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Your jobs</h2>
        <p className="text-sm text-muted-foreground">
          Take photos before, during, and after every job. {REQUIRED_STAGES.map((s) => STAGE_LABEL[s].toLowerCase()).join(" and ")} photos are required before you can send an invoice.
        </p>
        {jobs.length === 0 && <p className="rounded-xl border border-btr-line p-4 text-sm">No jobs are assigned to your crew right now. Call the office if that&apos;s wrong.</p>}
        <ul className="flex flex-col gap-2">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link href={`/crew/jobs/${j.id}`} className="flex flex-col gap-2 rounded-xl border border-btr-line bg-background p-4 active:bg-muted">
                <span>
                  <span className="block font-semibold">{j.name}</span>
                  {j.address && <span className="block text-sm text-muted-foreground">{j.address}</span>}
                </span>
                <span className="flex flex-wrap gap-1.5 text-xs">
                  {PHOTO_STAGES.map((s) => (
                    <span key={s} className={`rounded-full px-2 py-0.5 ${j.photos[s] ? "bg-btr-blue text-white" : REQUIRED_STAGES.includes(s) ? "border border-btr-black" : "bg-muted text-muted-foreground"}`}>
                      {STAGE_LABEL[s]} {j.photos[s] || ""}
                    </span>
                  ))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Your invoices</h2>
        {invoices.length === 0 && <p className="text-sm text-muted-foreground">None sent yet. Open a job to send one.</p>}
        <ul className="flex flex-col divide-y rounded-xl border border-btr-line">
          {invoices.map((i) => (
            <li key={i.id} className="flex flex-col gap-0.5 p-3 text-sm">
              <span className="flex justify-between gap-2">
                <span className="font-medium">{i.project.name}</span>
                <span className="tabular-nums">{usd(i.amount)}</span>
              </span>
              <span className="flex justify-between gap-2 text-muted-foreground">
                <span>
                  {i.invoiceNumber ? `#${i.invoiceNumber} · ` : ""}
                  {i.invoiceDate.toLocaleDateString("en-US", { timeZone: "UTC" })}
                </span>
                <span className={i.status === "REJECTED" ? "font-semibold text-foreground" : i.status === "SUBMITTED" ? "" : "text-btr-blue"}>{STATUS[i.status] ?? i.status}</span>
              </span>
              {i.status === "REJECTED" && i.reviewNote && <span>Office: {i.reviewNote}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
