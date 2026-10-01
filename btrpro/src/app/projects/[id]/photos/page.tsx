import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { driveAvailable } from "@/lib/integrations/google-sa";
import { jobPhotos, matchPhotoFolder, photoFolders, companyCamIdFromFile, type DrivePhoto, type PhotoFolder } from "@/lib/integrations/drive-photos";
import { PhotoFolderPicker } from "@/components/portal/forms";
import { CrewPhotos } from "./crew-photos";

const when = (d: Date | null) => (d ? d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");

/** Job photos: the crews' required before/finished/cleanup photos, then CompanyCam photos from Drive. */
export default async function PhotosPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { page } = await searchParams;
  return (
    <div className="flex flex-col gap-8">
      <CrewPhotos projectId={id} canEdit={user.role !== "VIEWER"} />
      <section className="flex flex-col gap-4 border-t pt-6">
        <CompanyCamPhotos id={id} user={user} page={page} />
      </section>
    </div>
  );
}

/** CompanyCam photos, read from the job's folder in Drive (CompanyCam syncs every project there). */
async function CompanyCamPhotos({ id, user, page }: { id: string; user: { id: string; role: string }; page?: string }) {
  const project = await prisma.project.findUnique({ where: { id }, select: { id: true, name: true, address: true, photoFolderId: true, companyCamId: true } });
  if (!project) notFound();
  const canEdit = user.role !== "VIEWER";
  if (!(await driveAvailable(user.id)))
    return (
      <p className="text-sm text-muted-foreground">
        Photos come from the CompanyCam folders in Google Drive. Drive isn&apos;t set up for the app yet (Admin → Integrations: add the service account key and share the CompanyCam folder with it).
      </p>
    );

  let folders: PhotoFolder[] = [];
  let folderId = project.photoFolderId;
  let error: string | null = null;
  try {
    folders = await photoFolders(user.id);
    // link automatically when exactly one CompanyCam folder has this job's street address
    if (!folderId && canEdit) {
      const m = matchPhotoFolder(project, folders);
      if (m) {
        folderId = m.id;
        await prisma.project.update({ where: { id }, data: { photoFolderId: m.id } });
        await prisma.projectActivity.create({ data: { projectId: id, kind: "details", text: `Photos linked to the CompanyCam folder "${m.name}" in Drive (matched by address)` } });
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  let photos: DrivePhoto[] = [];
  let next: string | null = null;
  if (folderId && !error) {
    try {
      ({ photos, next } = await jobPhotos(folderId, user.id, page ?? null));
      const ccId = photos.map((p) => companyCamIdFromFile(p.name)).find(Boolean);
      if (ccId && !project.companyCamId) await prisma.project.update({ where: { id }, data: { companyCamId: ccId } });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  const folder = folders.find((f) => f.id === folderId);
  const suggested = folderId ? null : matchPhotoFolder(project, folders);
  const ccId = project.companyCamId;

  // group by day, newest first
  const days = new Map<string, DrivePhoto[]>();
  for (const p of photos) {
    const k = p.takenAt ? p.takenAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "Undated";
    days.set(k, [...(days.get(k) ?? []), p]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Photos</h2>
          <p className="text-sm text-muted-foreground">
            {folder ? `From CompanyCam, via Drive: ${folder.name}` : "CompanyCam photos, read from the project's folder in Google Drive."}
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          {folderId && (
            <a className="underline" href={`https://drive.google.com/drive/folders/${folderId}`} target="_blank">
              Open folder in Drive
            </a>
          )}
          {ccId && (
            <a className="underline" href={`https://app.companycam.com/projects/${ccId}`} target="_blank">
              Open in CompanyCam
            </a>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {canEdit && (!folderId || folders.length > 0) && (
        <details open={!folderId} className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">{folderId ? "Change the photo folder" : "Link this job's CompanyCam folder"}</summary>
          <div className="mt-2">
            <PhotoFolderPicker projectId={id} folders={folders} current={folderId} suggested={suggested} />
            {!folderId && !suggested && <p className="mt-1 text-xs text-muted-foreground">No folder matched this job&apos;s street address automatically.</p>}
          </div>
        </details>
      )}
      {folderId && !error && photos.length === 0 && <p className="text-sm text-muted-foreground">No photos in that folder yet. They show up here as soon as CompanyCam syncs them to Drive.</p>}
      {[...days.entries()].map(([day, ps]) => (
        <section key={day} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            {day} · {ps.length}
          </h3>
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6">
            {ps.map((p) => (
              <a key={p.id} href={p.full} target="_blank" title={when(p.takenAt)} className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.thumb} alt={`Photo ${when(p.takenAt)}`} loading="lazy" className="aspect-square w-full rounded object-cover" />
              </a>
            ))}
          </div>
        </section>
      ))}
      {next && (
        <Link className="self-start text-sm underline" href={`/projects/${id}/photos?page=${encodeURIComponent(next)}`}>
          Older photos →
        </Link>
      )}
    </div>
  );
}
