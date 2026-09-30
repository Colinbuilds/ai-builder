// Job-schedule import: reads a schedule (Google Sheet via the Drive connection, or an uploaded .xlsx/.csv),
// previews which account each job lands in, then creates the jobs under those builder/customer accounts.
// Re-importing is safe: jobs are matched by import key, only moved forward in stage, never duplicated.
import { prisma } from "@/lib/db";
import { readUpload, saveUpload } from "@/lib/storage";
import { accessToken } from "@/lib/integrations/oauth";
import { parseDriveLink } from "@/lib/integrations/drive";
import { createProject } from "@/lib/projects/service";
import { readCsv, readXlsx, type Tab } from "./xlsx";
import {
  STAGE_RANK,
  matchAccount,
  parseSchedule,
  type Account,
  type ScheduleJob,
} from "./schedule";

const API = "https://www.googleapis.com/drive/v3/files";
const XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
type Actor = { id: string; name: string };
export type Market = "RESIDENTIAL" | "COMMERCIAL";

export async function tabsFromBytes(
  bytes: Uint8Array,
  fileName: string,
): Promise<Tab[]> {
  if (/\.csv$/i.test(fileName))
    return [
      readCsv(new TextDecoder().decode(bytes), fileName.replace(/\.csv$/i, "")),
    ];
  return readXlsx(bytes);
}

/** Downloads a Google Sheet (as .xlsx) or an .xlsx/.csv file from Drive and stores a copy, so preview and import read the same data. */
export async function fetchScheduleFromDrive(
  link: string,
  userId: string,
): Promise<{ fileUrl: string; fileName: string }> {
  const id = parseDriveLink(link);
  if (!id)
    throw new Error(
      "That doesn't look like a Google Sheets or Drive file link.",
    );
  const { token } = await accessToken("GOOGLE_DRIVE", userId);
  const get = async (url: string) => {
    const r = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (r.status === 404)
      throw new Error(
        "Drive says that file doesn't exist or isn't shared with your account.",
      );
    if (!r.ok) throw new Error(`Google Drive error (${r.status}).`);
    return r;
  };
  const meta: { name: string; mimeType: string } = await (
    await get(`${API}/${id}?fields=name,mimeType&supportsAllDrives=true`)
  ).json();
  const native = meta.mimeType === "application/vnd.google-apps.spreadsheet";
  if (!native && meta.mimeType !== XLSX && meta.mimeType !== "text/csv")
    throw new Error(`${meta.name} isn't a spreadsheet.`);
  const url = native
    ? `${API}/${id}/export?mimeType=${encodeURIComponent(XLSX)}`
    : `${API}/${id}?alt=media&supportsAllDrives=true`;
  const bytes = new Uint8Array(await (await get(url)).arrayBuffer());
  const fileName = native ? `${meta.name}.xlsx` : meta.name;
  return {
    fileUrl: await saveUpload(bytes, fileName, "imports/schedules"),
    fileName,
  };
}

export async function storeUploadedSchedule(
  bytes: Uint8Array,
  fileName: string,
) {
  if (!/\.(xlsx|csv)$/i.test(fileName))
    throw new Error(
      "Upload the schedule as .xlsx (File → Download → Microsoft Excel) or .csv.",
    );
  return {
    fileUrl: await saveUpload(bytes, fileName, "imports/schedules"),
    fileName,
  };
}

export const guessMarket = (fileName: string): Market =>
  /commercial|comm\b/i.test(fileName) ? "COMMERCIAL" : "RESIDENTIAL";

async function load(
  fileUrl: string,
  fileName: string,
  market: Market,
  include?: string[],
) {
  const tabs = await tabsFromBytes(
    new Uint8Array(await readUpload(fileUrl)),
    fileName,
  );
  return parseSchedule(tabs, { market, include });
}

export type AccountRow = {
  text: string;
  jobs: number;
  matchId: string | null;
  matchName: string | null;
  ambiguous: string[];
  suggestedType: string;
};
export type Preview = Awaited<ReturnType<typeof previewSchedule>>;

export async function previewSchedule(
  fileUrl: string,
  fileName: string,
  market: Market,
  include?: string[],
) {
  const parsed = await load(fileUrl, fileName, market, include);
  const accounts: Account[] = await prisma.company.findMany({
    select: { id: true, name: true, type: true },
    orderBy: { name: "asc" },
  });
  const byText = new Map<string, ScheduleJob[]>();
  for (const j of parsed.jobs)
    byText.set(j.account, [...(byText.get(j.account) ?? []), j]);
  const rows: AccountRow[] = [...byText.entries()]
    .map(([text, jobs]) => {
      const m = matchAccount(text, accounts);
      return {
        text,
        jobs: jobs.length,
        matchId: m.account?.id ?? null,
        matchName: m.account?.name ?? null,
        ambiguous: m.ambiguous.map((a) => a.name),
        suggestedType:
          market === "COMMERCIAL"
            ? "GC"
            : jobs.length > 1
              ? "BUILDER"
              : "OWNER",
      };
    })
    .sort((a, b) => b.jobs - a.jobs || a.text.localeCompare(b.text));
  const existing = new Set(
    (
      await prisma.project.findMany({
        where: { importKey: { in: parsed.jobs.map((j) => j.key) } },
        select: { importKey: true },
      })
    ).map((p) => p.importKey),
  );
  const stages: Record<string, number> = {};
  for (const j of parsed.jobs) stages[j.stage] = (stages[j.stage] ?? 0) + 1;
  return {
    tabs: parsed.tabs,
    accounts: rows,
    total: parsed.jobs.length,
    alreadyImported: parsed.jobs.filter((j) => existing.has(j.key)).length,
    stages,
    skipped: parsed.skipped.length,
    skippedSample: parsed.skipped.slice(0, 15),
    sample: parsed.jobs
      .slice(0, 12)
      .map((j) => ({
        account: j.account,
        name: j.name,
        stage: j.stage,
        sell: j.sell,
        sources: j.sources,
      })),
    accountChoices: accounts,
  };
}

/** mapping: schedule account text → company id, "NEW:<CompanyType>", or "SKIP". */
export async function importSchedule(
  opts: {
    fileUrl: string;
    fileName: string;
    market: Market;
    include?: string[];
    mapping: Record<string, string>;
    source: string;
  },
  actor: Actor,
) {
  const parsed = await load(
    opts.fileUrl,
    opts.fileName,
    opts.market,
    opts.include,
  );
  const users = await prisma.user.findMany({
    select: { id: true, name: true },
  });
  const userByName = new Map(
    users.map((u) => [u.name.trim().toLowerCase(), u.id]),
  );
  const created = new Map<string, string>();
  const typeOf = new Map(
    (await prisma.company.findMany({ select: { id: true, type: true } })).map(
      (c) => [c.id, c.type as string],
    ),
  );
  const result = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    accountsCreated: 0,
    errors: [] as string[],
  };

  const companyFor = async (text: string): Promise<string | null | "SKIP"> => {
    const choice = opts.mapping[text];
    if (!choice || choice === "SKIP") return "SKIP";
    if (choice === "NONE") return null;
    if (choice.startsWith("NEW:")) {
      if (created.has(text)) return created.get(text)!;
      const same = await prisma.company.findFirst({
        where: { name: text.trim() },
      });
      const id =
        same?.id ??
        (
          await prisma.company.create({
            data: {
              name: text.trim(),
              type: choice.slice(4) as never,
              notes: `Created by the job import from ${opts.source}`,
            },
          })
        ).id;
      if (!same) result.accountsCreated++;
      typeOf.set(id, same?.type ?? choice.slice(4));
      created.set(text, id);
      return id;
    }
    return choice;
  };

  for (const j of parsed.jobs) {
    try {
      const companyId = await companyFor(j.account);
      if (companyId === "SKIP") {
        result.skipped++;
        continue;
      }
      const note =
        `Imported from ${opts.source} (${j.sources.join("; ")}).${j.details.length ? " " + j.details.join(" · ") : ""}`.slice(
          0,
          4000,
        );
      const existing = await prisma.project.findFirst({
        where: { importKey: j.key },
      });
      if (existing) {
        const forward =
          STAGE_RANK[j.stage] >
          STAGE_RANK[existing.status as keyof typeof STAGE_RANK];
        const data = {
          ...(forward
            ? { status: j.stage as never, statusChangedAt: new Date() }
            : {}),
          ...(existing.contractAmount == null && j.sell != null
            ? { contractAmount: j.sell }
            : {}),
          ...(existing.clientCompanyId == null && companyId
            ? { clientCompanyId: companyId }
            : {}),
        };
        if (!Object.keys(data).length) {
          result.unchanged++;
          continue;
        }
        await prisma.project.update({ where: { id: existing.id }, data });
        await prisma.projectActivity.create({
          data: {
            projectId: existing.id,
            userId: actor.id,
            kind: "import",
            text: forward
              ? `Schedule import: ${existing.status} → ${j.stage}`
              : "Schedule import updated the job",
          },
        });
        result.updated++;
        continue;
      }
      const rep =
        j.salesRep && j.salesRep.toLowerCase() !== "house"
          ? (userByName.get(j.salesRep.trim().toLowerCase()) ?? null)
          : null;
      const p = await createProject(
        {
          name: j.name.slice(0, 200),
          market: j.market,
          address: j.address,
          buildingUse:
            j.market === "RESIDENTIAL" ? "Single-family residential" : null,
          constructionType:
            companyId && typeOf.get(companyId) === "BUILDER" ? "NEW" : null,
          scopes: j.scopes,
          isPublic: false,
          isTaxExempt: false,
          acculynxJobNumber: j.estimateNo,
          leadSource: "Schedule import",
          clientCompanyId: companyId,
          salespersonId: rep,
        },
        actor,
      );
      await prisma.project.update({
        where: { id: p.id },
        data: {
          status: j.stage as never,
          statusChangedAt: j.dateAdded ?? new Date(),
          contractAmount: j.sell,
          importKey: j.key,
          ...(j.dateAdded ? { createdAt: j.dateAdded } : {}),
        },
      });
      await prisma.projectActivity.create({
        data: {
          projectId: p.id,
          userId: actor.id,
          kind: "import",
          text:
            note + (j.builderJobNo ? ` · Builder job #${j.builderJobNo}` : ""),
        },
      });
      result.created++;
    } catch (e) {
      result.errors.push(
        `${j.name}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return result;
}
