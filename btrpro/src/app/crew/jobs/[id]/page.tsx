import { notFound } from "next/navigation";
import { requireCrew } from "@/lib/crew/auth";
import { crewJobs, PHOTO_STAGES, REQUIRED_STAGES, STAGE_HINT, STAGE_LABEL } from "@/lib/crew/service";
import { prisma } from "@/lib/db";
import { CrewInvoiceForm, PhotoUploader } from "@/components/crew/forms";
import { CrewHeader } from "../../crew-header";

export const metadata = { title: "BTR crew portal" };

export default async function CrewJob({ params }: { params: Promise<{ id: string }> }) {
  const crew = await requireCrew();
  const { id } = await params;
  const job = (await crewJobs(crew.id)).find((j) => j.id === id);
  if (!job) notFound();
  const photos = await prisma.jobPhoto.findMany({ where: { crewId: crew.id, projectId: id }, orderBy: { takenAt: "desc" }, take: 60 });
  const blocked = job.missing.length
    ? `Add your ${job.missing.map((s) => STAGE_LABEL[s].toLowerCase()).join(" and ")} photos above first. They're required before you can send an invoice.`
    : null;
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <CrewHeader name={crew.name} back />
      <div>
        <h1 className="text-xl font-semibold">{job.name}</h1>
        {job.address && (
          <a className="text-sm text-btr-link underline" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}`} target="_blank" rel="noreferrer">
            {job.address}
          </a>
        )}
      </div>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Job photos</h2>
        {PHOTO_STAGES.map((s) => (
          <PhotoUploader key={s} projectId={id} stage={s} label={STAGE_LABEL[s]} hint={STAGE_HINT[s]} count={job.photos[s]} required={REQUIRED_STAGES.includes(s)} />
        ))}
        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-1">
            {photos.map((p) => (
              <a key={p.id} href={`/api/crew/photo/${p.id}`} target="_blank" className="relative block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/crew/photo/${p.id}?w=300`} alt={STAGE_LABEL[p.stage as keyof typeof STAGE_LABEL]} loading="lazy" className="aspect-square w-full rounded object-cover" />
                <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-white">{STAGE_LABEL[p.stage as keyof typeof STAGE_LABEL]}</span>
                {p.review === "ISSUE" && <span className="absolute top-1 right-1 rounded bg-white px-1 text-[10px] font-semibold text-black">Flagged</span>}
              </a>
            ))}
          </div>
        )}
      </section>
      <section className="flex flex-col gap-3 rounded-xl border border-btr-line bg-background p-4">
        <h2 className="text-lg font-semibold">Send an invoice for this job</h2>
        <CrewInvoiceForm projectId={id} blocked={blocked} />
      </section>
    </div>
  );
}
