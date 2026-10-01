// CompanyCam stays BTR's photo tool; a job links to its CompanyCam project and shows the photos here.
// API token in COMPANYCAM_TOKEN (CompanyCam → Settings → Integrations/API). Without it the job keeps a plain link.
import { prisma } from "@/lib/db";

const API = "https://api.companycam.com/v2";
export const companyCamConfigured = () => !!process.env.COMPANYCAM_TOKEN;
export const companyCamProjectUrl = (id: string) =>
  `https://app.companycam.com/projects/${id}`;

/** "https://app.companycam.com/projects/12345/photos" or "12345" → "12345". */
export function parseCompanyCamLink(s: string): string | null {
  const t = s.trim();
  const m = t.match(/companycam\.com\/projects\/(\d+)/i);
  if (m) return m[1];
  return /^\d{3,}$/.test(t) ? t : null;
}

async function cc<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    headers: {
      authorization: `Bearer ${process.env.COMPANYCAM_TOKEN}`,
      accept: "application/json",
    },
    cache: "no-store",
  });
  if (r.status === 401)
    throw new Error("CompanyCam rejected the API token (COMPANYCAM_TOKEN).");
  if (r.status === 404) throw new Error("CompanyCam can't find that project.");
  if (!r.ok) throw new Error(`CompanyCam error (${r.status}).`);
  return r.json() as Promise<T>;
}

type CcProject = {
  id: string | number;
  name?: string;
  address?: { street_address_1?: string; city?: string; state?: string };
};
type CcPhoto = {
  id: string | number;
  captured_at?: number;
  creator_name?: string;
  uris?: { type: string; uri: string }[];
};
export type Photo = {
  id: string;
  thumb: string;
  web: string;
  takenAt: Date | null;
  by: string | null;
};

export async function searchCompanyCam(query: string) {
  if (!companyCamConfigured() || !query.trim()) return [];
  const list = await cc<CcProject[]>(
    `/projects?query=${encodeURIComponent(query.trim())}&per_page=10`,
  );
  return list.map((p) => ({
    id: String(p.id),
    name: p.name ?? "",
    address: [p.address?.street_address_1, p.address?.city, p.address?.state]
      .filter(Boolean)
      .join(", "),
  }));
}

export async function companyCamPhotos(
  projectCamId: string,
  limit = 24,
): Promise<Photo[]> {
  if (!companyCamConfigured()) return [];
  const list = await cc<CcPhoto[]>(
    `/projects/${encodeURIComponent(projectCamId)}/photos?per_page=${limit}`,
  );
  return list.flatMap((p) => {
    const uri = (t: string) => p.uris?.find((u) => u.type === t)?.uri;
    const web = uri("web") ?? uri("original") ?? uri("thumbnail");
    if (!web) return [];
    return [
      {
        id: String(p.id),
        thumb: uri("thumbnail") ?? web,
        web,
        takenAt: p.captured_at ? new Date(p.captured_at * 1000) : null,
        by: p.creator_name ?? null,
      },
    ];
  });
}

export async function linkCompanyCam(
  projectId: string,
  link: string | null,
  actor: { id: string; name: string },
) {
  const id = link?.trim() ? parseCompanyCamLink(link) : null;
  if (link?.trim() && !id)
    throw new Error(
      "Paste the CompanyCam project link (app.companycam.com/projects/…).",
    );
  await prisma.project.update({
    where: { id: projectId },
    data: { companyCamId: id },
  });
  await prisma.projectActivity.create({
    data: {
      projectId,
      userId: actor.id,
      kind: "details",
      text: id
        ? `${actor.name} linked CompanyCam project ${id}`
        : `${actor.name} unlinked CompanyCam`,
    },
  });
  return id;
}
