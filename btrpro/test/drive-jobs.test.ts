// TEST_ONLY Drive job import against a fake Drive: scan, match to the estimating schedule, copy files with paths,
// skip plan-room junk, and never copy a file twice.
import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { saveSettings } from "@/lib/settings";
import { importDriveFolder, scanDriveJobs } from "@/lib/import/drive-jobs";

const SYS = { id: "", name: "TEST_ONLY" };
const now = new Date().toISOString();
const TREE: Record<string, { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string }[]> = {
  ROOT: [
    { id: "F1", name: "TEST_ONLY Builder Apartment 999", mimeType: "application/vnd.google-apps.folder", modifiedTime: now, createdTime: now } as never,
    { id: "F2", name: "(OLD DO NOT USE) TEST_ONLY", mimeType: "application/vnd.google-apps.folder", modifiedTime: now } as never,
  ],
  F1: [{ id: "E", name: "Estimating", mimeType: "application/vnd.google-apps.folder" }],
  E: [
    { id: "P", name: "Plans", mimeType: "application/vnd.google-apps.folder" },
    { id: "S1", name: "Siding L&M takeoff", mimeType: "application/vnd.google-apps.spreadsheet" },
  ],
  P: [
    { id: "PDF1", name: "plans.pdf", mimeType: "application/pdf", size: "5" },
    { id: "J1", name: "Sign up to our Newsletter.pdf", mimeType: "application/pdf", size: "5" },
  ],
};

beforeAll(async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "test_only@example.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
  await saveSettings({ jobsDriveId: "ROOT", driveImportMonths: 12 }, SYS);
  await prisma.estimateLog.create({ data: { board: "SOLD", market: "COMMERCIAL", project: "TEST_ONLY Apartment 999", folderLink: "https://drive.google.com/drive/folders/F1", source: "APP" } });
  vi.stubGlobal("fetch", async (u: string) => {
    const url = new URL(u);
    if (url.hostname === "oauth2.googleapis.com") return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
    if (url.pathname.endsWith("/files")) {
      const parent = url.searchParams.get("q")!.match(/'([^']+)' in parents/)![1];
      return new Response(JSON.stringify({ files: TREE[parent] ?? [] }));
    }
    if (url.pathname.includes("/export")) return new Response(new Uint8Array([80, 75, 3, 4, 1]));
    return new Response(new TextEncoder().encode("TEST_ONLY file"));
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const p = await prisma.project.findMany({ where: { name: { startsWith: "TEST_ONLY" } }, select: { id: true } });
  await prisma.document.deleteMany({ where: { projectId: { in: p.map((x) => x.id) } } });
  await prisma.estimateLog.deleteMany({ where: { project: "TEST_ONLY Apartment 999" } });
  await prisma.project.deleteMany({ where: { id: { in: p.map((x) => x.id) } } });
  await prisma.driveJobFolder.deleteMany({ where: { name: { contains: "TEST_ONLY" } } });
  await saveSettings({ jobsDriveId: null, driveImportMonths: null, driveImportScannedAt: null }, SYS);
});

describe("Drive job import", () => {
  it("scans job folders, creates the job from the estimating schedule, copies files with their paths once", async () => {
    expect((await scanDriveJobs()).folders).toBe(1); // the OLD DO NOT USE folder is left out
    const row = await prisma.driveJobFolder.findUniqueOrThrow({ where: { folderId: "F1" } });
    expect(row.fileCount).toBe(2); // newsletter junk not counted
    const r = await importDriveFolder(row.id);
    expect(r).toMatchObject({ added: 2, errors: [] });
    const done = await prisma.driveJobFolder.findUniqueOrThrow({ where: { folderId: "F1" } });
    expect(done.status).toBe("DONE");
    const job = await prisma.project.findUniqueOrThrow({ where: { id: done.projectId! } });
    expect(job).toMatchObject({ driveFolderId: "F1", status: "SOLD", market: "COMMERCIAL" });
    const docs = await prisma.document.findMany({ where: { projectId: job.id }, orderBy: { fileName: "asc" } });
    expect(docs.map((d) => d.fileName)).toEqual(["Estimating › Plans › plans.pdf", "Estimating › Siding L&M takeoff.xlsx"]);
    // second run copies nothing new and keeps the same job
    const again = await importDriveFolder(row.id);
    expect(again.added).toBe(0);
    expect(await prisma.project.count({ where: { driveFolderId: "F1" } })).toBe(1);
  });
});
