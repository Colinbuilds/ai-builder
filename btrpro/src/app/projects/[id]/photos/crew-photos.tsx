import { prisma } from "@/lib/db";
import { PHOTO_STAGES, REQUIRED_STAGES, STAGE_LABEL } from "@/lib/crew/service";
import { PhotoReview, StaffPhotoUpload } from "@/components/crew/office";

/** Crew (and staff) photos by stage, with the office's quality/cleanliness check on each. */
export async function CrewPhotos({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const photos = await prisma.jobPhoto.findMany({ where: { projectId }, include: { crew: { select: { name: true } } }, orderBy: { takenAt: "desc" }, take: 400 });
  const pending = photos.filter((p) => p.review === "PENDING").length;
  return (
    <section id="crew" className="flex scroll-mt-28 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Job photos (crews)</h2>
          <p className="text-sm text-muted-foreground">
            Crews send these from their portal: before, during, finished work, and site cleanup. {REQUIRED_STAGES.map((s) => STAGE_LABEL[s]).join(" and ")} are required before a crew can invoice. Mark each
            OK or flag a quality or cleanup issue — the crew sees flags in their portal.
          </p>
        </div>
        {pending > 0 && <span className="rounded-full bg-btr-blue px-2.5 py-1 text-xs font-semibold text-white">{pending} to check</span>}
      </div>
      {canEdit && <StaffPhotoUpload projectId={projectId} stages={PHOTO_STAGES.map((s) => [s, STAGE_LABEL[s]])} />}
      {photos.length === 0 && <p className="text-sm text-muted-foreground">No crew photos yet.</p>}
      {PHOTO_STAGES.map((stage) => {
        const ps = photos.filter((p) => p.stage === stage);
        if (!ps.length) return null;
        return (
          <div key={stage} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">
              {STAGE_LABEL[stage]} <span className="font-normal text-muted-foreground">· {ps.length}</span>
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {ps.map((p) => (
                <figure key={p.id} className={`flex flex-col gap-1 rounded-md border p-1.5 ${p.review === "ISSUE" ? "border-btr-black" : "border-btr-line"}`}>
                  <a href={`/api/crew/photo/${p.id}`} target="_blank">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/crew/photo/${p.id}?w=400`} alt={`${STAGE_LABEL[stage]} photo`} loading="lazy" className="aspect-square w-full rounded object-cover" />
                  </a>
                  <figcaption className="text-[11px] text-muted-foreground">
                    {p.crew?.name ?? p.uploadedBy} · {p.takenAt.toLocaleString("en-US", { timeZone: "America/Chicago", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    {p.note && <span className="block text-foreground">{p.note}</span>}
                  </figcaption>
                  {canEdit ? <PhotoReview id={p.id} review={p.review} note={p.reviewNote} /> : p.review !== "PENDING" && <span className="text-xs">{p.review === "OK" ? "Checked OK" : `Issue: ${p.reviewNote}`}</span>}
                </figure>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
