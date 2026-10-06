import type { Metadata } from "next";
import { getCompany } from "@/lib/company-profile";
import { PROPERTY_TYPES, RELATIONSHIPS, ROOF_NOW, STORIES, TIMELINES, WANTS } from "@/lib/leads/web";
import { RequestForm } from "@/components/leads/request-form";

export async function generateMetadata(): Promise<Metadata> {
  const co = await getCompany();
  return { title: `Free estimate — ${co.name}`, description: `Tell ${co.name} about your roofing or siding project, add a photo, and see new looks on your own home.` };
}

export default async function QuotePage() {
  const co = await getCompany();
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5 py-2">
      <header className="flex flex-col gap-1 border-b pb-3">
        <p className="text-lg font-semibold">{co.name}</p>
        <h1 className="text-2xl font-semibold">Free roofing &amp; siding estimate</h1>
        <p className="text-sm text-muted-foreground">Tell us what you&apos;d like done and add a photo of your property. You&apos;ll be able to try new roof and siding colors on your own photo, and we&apos;ll call to set up a free inspection.</p>
      </header>
      <RequestForm
        wants={Object.fromEntries(Object.entries(WANTS).map(([k, v]) => [k, v.label]))}
        propertyTypes={{ ...PROPERTY_TYPES }}
        relationships={{ ...RELATIONSHIPS }}
        timelines={{ ...TIMELINES }}
        stories={STORIES}
        roofNow={ROOF_NOW}
        phone={co.phone}
      />
    </div>
  );
}
