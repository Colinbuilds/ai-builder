import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCompany } from "@/lib/company-profile";
import { prisma } from "@/lib/db";
import { TIMELINES, WANTS, leadByToken, type Photo, type Rendering, type Want } from "@/lib/leads/web";
import { ROOF_COLORS, ROOF_STYLES, SIDING_COLORS, SIDING_STYLES, TRIM_COLORS, renderProvider } from "@/lib/render";
import { Studio } from "@/components/leads/studio";
import { favoriteAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const co = await getCompany();
  return { title: `Your request — ${co.name}`, robots: { index: false } };
}
const strip = <T extends { key: string; label: string; hex: string }>(l: T[]) => l.map(({ key, label, hex }) => ({ key, label, hex }));

export default async function RequestPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ new?: string }> }) {
  const co = await getCompany();
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const lead = await leadByToken(token);
  if (!lead) notFound();
  const rep = lead.assignedToId ? await prisma.user.findUnique({ where: { id: lead.assignedToId }, select: { name: true, phone: true } }) : null;
  const photos = lead.photos as Photo[];
  const renders = (lead.renderings as Rendering[] | null) ?? [];
  const wants = (lead.workTypes as string[]).map((w) => w as Want);
  const roof = wants.some((w) => ["ROOF_REPLACE", "ROOF_REPAIR", "NEW_ROOF", "STORM"].includes(w));
  const siding = wants.some((w) => ["SIDING", "SIDING_REPAIR"].includes(w));
  const enabled = !!renderProvider();
  const nice = lead.inspectionAt?.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 py-2">
      <header className="flex flex-col gap-1 border-b pb-3">
        <p className="text-lg font-semibold">{co.name}</p>
        <p className="text-sm text-muted-foreground">
          {co.phone} · {co.email}
        </p>
      </header>

      {sp.new && (
        <div className="rounded-xl bg-btr-blue-soft p-4">
          <p className="text-lg font-semibold">Thanks, {lead.firstName} — we got your request.</p>
          <p className="text-sm">Bookmark this page. It shows where your request stands, and you can try new looks on your photo below.</p>
        </div>
      )}

      <section className="flex flex-col gap-2 rounded-xl border bg-background p-4">
        <h1 className="text-xl font-semibold">Where things stand</h1>
        <ol className="flex flex-col gap-2 text-sm">
          <li>✓ Request received {lead.createdAt.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" })}</li>
          <li>{rep ? `✓ ${rep.name.split(" ")[0]} is your project consultant${rep.phone ? ` · ${rep.phone}` : ""}` : "○ A project consultant will be assigned shortly"}</li>
          <li>{nice ? `✓ Free inspection: ${nice}${lead.inspectionWhen ? ` at ${lead.inspectionWhen}` : ""}` : `○ We'll call ${lead.phone} to set up your free inspection`}</li>
        </ol>
        <p className="text-xs text-muted-foreground">Questions or need to change something? Call {co.phone}.</p>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border bg-background p-4">
        <h2 className="text-xl font-semibold">Try a new look on your home</h2>
        <p className="text-sm text-muted-foreground">
          Pick a roof or siding color and we&apos;ll show it on your photo. Renderings are concepts to help you decide — colors and details are approximate, and your consultant will bring real
          samples.
        </p>
        <Studio
          token={token}
          photos={photos.length}
          roof={roof}
          siding={siding}
          roofStyles={strip(ROOF_STYLES)}
          roofColors={strip(ROOF_COLORS)}
          sidingStyles={strip(SIDING_STYLES)}
          sidingColors={strip(SIDING_COLORS)}
          trims={strip(TRIM_COLORS)}
          left={8 - lead.renderCount}
          enabled={enabled}
        />
        {renders.length > 0 && (
          <div className="mt-2 flex flex-col gap-4">
            {renders
              .map((r, i) => ({ r, i }))
              .reverse()
              .map(({ r, i }) => (
                <figure key={i} className="flex flex-col gap-1">
                  {r.url ? (
                  <div className="grid grid-cols-2 gap-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/q/${token}/photo/${r.photo}?w=900`} alt="Your photo" className="w-full rounded-lg" />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/q/${token}/render/${i}?w=900`} alt={`Concept: ${r.label}`} className="w-full rounded-lg" />
                  </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Saved for your consultant</p>
                  )}
                  <figcaption className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      <span className="text-muted-foreground">{r.url ? "Today → concept: " : "Your pick: "}</span>
                      {r.label}
                    </span>
                    <form action={favoriteAction}>
                      <input type="hidden" name="token" value={token} />
                      <input type="hidden" name="index" value={i} />
                      <button className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-sm ${r.favorite ? "border-btr-blue bg-btr-blue text-white" : ""}`}>{r.favorite ? "★ I like this one" : "☆ I like this one"}</button>
                    </form>
                  </figcaption>
                </figure>
              ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-xl border bg-background p-4 text-sm">
        <h2 className="text-lg font-semibold">What you told us</h2>
        <p>
          <b>{wants.map((w) => WANTS[w]?.label ?? w).join(", ")}</b>
          {lead.insurance && " · insurance claim"}
          {lead.timeline && ` · ${TIMELINES[lead.timeline as keyof typeof TIMELINES] ?? lead.timeline}`}
        </p>
        <p className="whitespace-pre-wrap">{lead.description}</p>
        <p className="text-muted-foreground">
          {lead.street}, {lead.city}, {lead.state} {lead.zip}
        </p>
        <div className="grid grid-cols-4 gap-1">
          {photos.map((_, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={`/api/q/${token}/photo/${i}?w=300`} alt={`Your photo ${i + 1}`} className="aspect-square w-full rounded object-cover" />
          ))}
        </div>
      </section>
    </div>
  );
}
