"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { saveBuilder, BuilderError } from "@/lib/builders";

export type BResult = { problems: string[]; ok?: boolean } | null;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim() || null;

export async function saveBuilderAction(_: BResult, f: FormData): Promise<BResult> {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  const id = str(f, "id");
  let savedId: string;
  try {
    const fb = str(f, "pricingFallback");
    const b = await saveBuilder(
      id,
      {
        name: str(f, "name") ?? "",
        phone: str(f, "phone"),
        email: str(f, "email"),
        address: str(f, "address"),
        website: str(f, "website"),
        abcAccount: str(f, "abcAccount"),
        sheetPrefix: str(f, "sheetPrefix"),
        pricingFallback: fb === "STANDARD" || fb === "MISSING" ? fb : null,
        poRequired: f.get("poRequired") === "on",
        standardSpecs: str(f, "standardSpecs"),
        billingTerms: str(f, "billingTerms"),
        notes: str(f, "notes"),
      },
      u,
    );
    savedId = b.id;
  } catch (e) {
    if (e instanceof BuilderError) return { problems: [e.message] };
    throw e;
  }
  revalidatePath("/builders", "layout");
  if (!id) redirect(`/builders/${savedId}?tab=pricing`);
  return { problems: [], ok: true };
}
