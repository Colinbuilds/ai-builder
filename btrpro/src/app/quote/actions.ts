"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { LeadFormError, addRendering, setFavorite, submitWebLead } from "@/lib/leads/web";
import { RenderError } from "@/lib/render";

export type FormResult = { problems: string[]; ok?: boolean } | null;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const msg = (e: unknown) => (e instanceof LeadFormError || e instanceof RenderError ? e.message : "Something went wrong on our side. Please try again, or call us.");

export async function submitRequestAction(_: FormResult, f: FormData): Promise<FormResult> {
  // bots fill hidden fields and submit instantly
  if (str(f, "website") || Date.now() - Number(str(f, "t") || 0) < 4000) return { problems: ["Please try again."] };
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? null;
  let token: string;
  try {
    const files = await Promise.all(
      f
        .getAll("photos")
        .filter((x): x is File => x instanceof File && x.size > 0)
        .map(async (x) => ({ bytes: new Uint8Array(await x.arrayBuffer()), name: x.name || "photo" })),
    );
    const lead = await submitWebLead(
      {
        firstName: str(f, "firstName"),
        lastName: str(f, "lastName"),
        phone: str(f, "phone"),
        email: str(f, "email"),
        contactPref: str(f, "contactPref") || null,
        textOk: f.get("textOk") === "on",
        street: str(f, "street"),
        city: str(f, "city"),
        state: str(f, "state") || "NE",
        zip: str(f, "zip"),
        propertyType: str(f, "propertyType"),
        relationship: str(f, "relationship"),
        wants: f.getAll("wants").map(String),
        description: str(f, "description"),
        stories: str(f, "stories") || null,
        currentRoof: str(f, "currentRoof") || null,
        roofAge: str(f, "roofAge") || null,
        insurance: str(f, "insurance") === "yes",
        insuranceCarrier: str(f, "insuranceCarrier") || null,
        claimNumber: str(f, "claimNumber") || null,
        dateOfLoss: str(f, "dateOfLoss") || null,
        timeline: str(f, "timeline") || null,
        heardFrom: str(f, "heardFrom") || null,
        inspectionTimes: str(f, "inspectionTimes") || null,
      },
      files,
      { ip },
    );
    token = lead.token;
  } catch (e) {
    if (!(e instanceof LeadFormError)) console.error("web lead submit failed", e);
    return { problems: [msg(e)] };
  }
  redirect(`/quote/${token}?new=1`);
}

export async function renderAction(_: FormResult, f: FormData): Promise<FormResult> {
  const token = str(f, "token");
  try {
    await addRendering(token, Number(str(f, "photo") || 0), {
      roofStyle: str(f, "roofStyle") || null,
      roofColor: str(f, "roofColor") || null,
      sidingStyle: str(f, "sidingStyle") || null,
      sidingColor: str(f, "sidingColor") || null,
      trim: str(f, "trim") || null,
    });
  } catch (e) {
    if (!(e instanceof LeadFormError || e instanceof RenderError)) console.error("rendering failed", e);
    return { problems: [msg(e)] };
  }
  revalidatePath(`/quote/${token}`);
  return { problems: [], ok: true };
}

export async function favoriteAction(f: FormData) {
  const token = str(f, "token");
  await setFavorite(token, Number(str(f, "index")));
  revalidatePath(`/quote/${token}`);
}
