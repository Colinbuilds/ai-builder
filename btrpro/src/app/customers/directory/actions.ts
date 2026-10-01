"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { DirectoryError, importDirectory, readDirectory, startDirectoryImport } from "@/lib/directory";
import { aiErrorMessage } from "@/lib/ai/claude";

export type DResult = { problems: string[]; ok?: boolean; note?: string } | null;
const msg = (e: unknown) => (e instanceof DirectoryError ? e.message : aiErrorMessage(e));

export async function uploadDirectoryAction(_: DResult, f: FormData): Promise<DResult> {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  const file = f.get("file");
  if (!(file instanceof File) || !file.size) return { problems: ["Choose the directory file."] };
  let id: string;
  try {
    id = await startDirectoryImport({ bytes: new Uint8Array(await file.arrayBuffer()), name: file.name || "directory" }, String(f.get("companyId") ?? "") || null, u.id);
  } catch (e) {
    return { problems: [msg(e)] };
  }
  // a long directory takes a minute to read; the preview page refreshes until it's done
  void readDirectory(id).catch((e) => console.error("directory read failed", id, e));
  redirect(`/customers/directory/${id}`);
}

export async function importDirectoryAction(_: DResult, f: FormData): Promise<DResult> {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  const id = String(f.get("id") ?? "");
  const companyId = String(f.get("companyId") ?? "");
  let r;
  try {
    r = await importDirectory(
      id,
      companyId && companyId !== "new" ? { companyId } : { newCompany: { name: String(f.get("companyName") ?? ""), type: String(f.get("companyType") ?? "PROPERTY_MANAGER") } },
      { id: u.id, name: u.name, role: u.role },
    );
  } catch (e) {
    return { problems: [msg(e)] };
  }
  revalidatePath(`/customers/companies/${r.companyId}`);
  redirect(`/customers/companies/${r.companyId}?imported=${id}`);
}

export async function rereadDirectoryAction(_: DResult, f: FormData): Promise<DResult> {
  await requireUser(["ADMIN", "ESTIMATOR"]);
  const id = String(f.get("id") ?? "");
  const { prisma } = await import("@/lib/db");
  await prisma.directoryImport.update({ where: { id }, data: { status: "READING", error: null } });
  void readDirectory(id).catch((e) => console.error("directory read failed", id, e));
  revalidatePath(`/customers/directory/${id}`);
  return { problems: [], ok: true };
}
