// Migration off AccuLynx (§13): import the AccuLynx jobs export (CSV or Excel) — jobs, their customers and
// companies, stage, salesperson, lead source, insurance info. Columns are matched by name and can be corrected
// in the preview. Re-importing updates by AccuLynx job number; a job already in BTRpro at the same address
// (e.g. from the schedule import) is linked instead of duplicated.
import { prisma } from "@/lib/db";
import { readUpload, saveUpload } from "@/lib/storage";
import { createProject } from "@/lib/projects/service";
import { tabsFromBytes } from "./service";
import {
  STAGE_RANK,
  matchAccount,
  norm,
  parseDate,
  parseMoney,
  scopesFor,
  type Stage,
} from "./schedule";

export const AX_FIELDS = {
  jobNumber: {
    label: "Job number",
    names: ["job number", "job #", "job no", "job id", "jobnumber", "number"],
  },
  jobName: {
    label: "Job name",
    names: ["job name", "name", "job", "project name"],
  },
  milestone: {
    label: "Milestone / status",
    names: ["milestone", "current milestone", "status", "job status", "stage"],
  },
  street: {
    label: "Street",
    names: [
      "street",
      "address",
      "job address",
      "address 1",
      "address line 1",
      "street address",
      "location",
    ],
  },
  city: { label: "City", names: ["city", "job city"] },
  state: { label: "State", names: ["state", "job state", "st"] },
  zip: { label: "ZIP", names: ["zip", "zip code", "postal code", "job zip"] },
  firstName: {
    label: "Contact first name",
    names: ["first name", "contact first name", "customer first name"],
  },
  lastName: {
    label: "Contact last name",
    names: ["last name", "contact last name", "customer last name"],
  },
  contactName: {
    label: "Contact name (full)",
    names: [
      "contact",
      "contact name",
      "customer",
      "customer name",
      "primary contact",
      "homeowner",
    ],
  },
  phone: {
    label: "Phone",
    names: [
      "phone",
      "primary phone",
      "contact phone",
      "mobile",
      "cell",
      "phone number",
    ],
  },
  email: {
    label: "Email",
    names: ["email", "primary email", "contact email", "email address"],
  },
  company: {
    label: "Company / builder / GC",
    names: [
      "company",
      "company name",
      "account",
      "builder",
      "general contractor",
      "customer company",
    ],
  },
  salesperson: {
    label: "Salesperson",
    names: [
      "salesperson",
      "sales person",
      "sales owner",
      "sales rep",
      "rep",
      "assigned to",
      "sales representative",
    ],
  },
  leadSource: {
    label: "Lead source",
    names: ["lead source", "source", "marketing source"],
  },
  trade: {
    label: "Trade / work type",
    names: [
      "trade types",
      "trade type",
      "trades",
      "work type",
      "job type",
      "job category",
      "category",
    ],
  },
  created: {
    label: "Created date",
    names: [
      "created date",
      "date created",
      "created",
      "lead date",
      "created on",
    ],
  },
  amount: {
    label: "Contract / job value",
    names: [
      "contract amount",
      "approved job value",
      "job value",
      "contract value",
      "total",
      "contract total",
      "sold amount",
    ],
  },
  carrier: {
    label: "Insurance company",
    names: ["insurance company", "insurance carrier", "carrier", "insurance"],
  },
  claim: {
    label: "Claim number",
    names: ["claim number", "claim #", "claim no", "claim"],
  },
  dateOfLoss: {
    label: "Date of loss",
    names: ["date of loss", "loss date", "dol"],
  },
} as const;
export type AxField = keyof typeof AX_FIELDS;
export const AX_FIELD_KEYS = Object.keys(AX_FIELDS) as AxField[];

// AccuLynx milestones → BTRpro stages. Anything else is left for the person to map in the preview.
const MILESTONE: [RegExp, Stage][] = [
  [/cancel|dead|lost|declin/i, "LOST"],
  [/^lead|unassigned|new lead/i, "LEAD"],
  [/prospect|inspect|estimat|appointment/i, "ESTIMATING"],
  [/proposal|submitted|bid sent/i, "SUBMITTED"],
  [/approved|sold|contract/i, "SOLD"],
  [/schedul/i, "SCHEDULED"],
  [/production|in progress|started/i, "IN_PRODUCTION"],
  [/complete/i, "COMPLETE"],
  [/invoic/i, "INVOICED"],
  [/paid/i, "PAID"],
  [/closed/i, "CLOSED"],
];
export const milestoneStage = (m: string): Stage | null =>
  MILESTONE.find(([re]) => re.test(m.trim()))?.[1] ?? null;

/** Column index for each field, from the header names. */
export function autoMap(header: string[]): Partial<Record<AxField, number>> {
  const h = header.map((x) => norm(x));
  const out: Partial<Record<AxField, number>> = {};
  const used = new Set<number>();
  for (const f of AX_FIELD_KEYS) {
    const i = h.findIndex(
      (x, idx) =>
        !used.has(idx) &&
        (AX_FIELDS[f].names as readonly string[]).some((n) => x === norm(n)),
    );
    if (i >= 0) {
      out[f] = i;
      used.add(i);
    }
  }
  return out;
}

export type AxRow = {
  row: number;
  jobNumber: string | null;
  name: string;
  address: string | null;
  milestone: string;
  contact: {
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
  } | null;
  company: string | null;
  salesperson: string | null;
  leadSource: string | null;
  trade: string | null;
  created: Date | null;
  amount: number | null;
  carrier: string | null;
  claim: string | null;
  dateOfLoss: Date | null;
};

function splitName(full: string) {
  const t = full.trim().replace(/\s+/g, " ");
  if (t.includes(",")) {
    const [last, first] = t.split(",").map((x) => x.trim());
    return { firstName: first || last, lastName: first ? last : "" };
  }
  const parts = t.split(" ");
  return {
    firstName: parts.slice(0, -1).join(" ") || parts[0],
    lastName: parts.length > 1 ? parts[parts.length - 1] : "",
  };
}

export function readRows(
  rows: string[][],
  map: Partial<Record<AxField, number>>,
): { rows: AxRow[]; skipped: number } {
  const get = (r: string[], f: AxField) =>
    map[f] != null ? (r[map[f]!] ?? "").trim() : "";
  const out: AxRow[] = [];
  let skipped = 0;
  rows.forEach((r, i) => {
    if (!r.some((c) => c?.trim())) return;
    const street = get(r, "street");
    const cityLine = [
      get(r, "city"),
      [get(r, "state"), get(r, "zip")].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join(", ");
    const address = [street, cityLine].filter(Boolean).join(", ") || null;
    let first = get(r, "firstName");
    let last = get(r, "lastName");
    if (!first && !last && get(r, "contactName"))
      ({ firstName: first, lastName: last } = splitName(get(r, "contactName")));
    const name =
      get(r, "jobName") ||
      [last || first, street].filter(Boolean).join(" — ") ||
      get(r, "jobNumber");
    if (!name) {
      skipped++;
      return;
    }
    out.push({
      row: i + 2,
      jobNumber: get(r, "jobNumber") || null,
      name,
      address,
      milestone: get(r, "milestone"),
      contact:
        first || last
          ? {
              firstName: first || last,
              lastName: last || first,
              phone: get(r, "phone") || null,
              email: get(r, "email") || null,
            }
          : null,
      company: get(r, "company") || null,
      salesperson: get(r, "salesperson") || null,
      leadSource: get(r, "leadSource") || null,
      trade: get(r, "trade") || null,
      created:
        parseDate(get(r, "created")) ??
        (get(r, "created") && !Number.isNaN(Date.parse(get(r, "created")))
          ? new Date(get(r, "created"))
          : null),
      amount: parseMoney(get(r, "amount")),
      carrier: get(r, "carrier") || null,
      claim: get(r, "claim") || null,
      dateOfLoss: parseDate(get(r, "dateOfLoss")),
    });
  });
  return { rows: out, skipped };
}

const addrKey = (a: string | null) => norm(a?.split(",")[0] ?? "");

// ---------- service ----------

export async function storeAccuLynxExport(bytes: Uint8Array, fileName: string) {
  if (!/\.(xlsx|csv)$/i.test(fileName))
    throw new Error("Upload the AccuLynx export as .csv or .xlsx.");
  return {
    fileUrl: await saveUpload(bytes, fileName, "imports/acculynx"),
    fileName,
  };
}

async function loadGrid(fileUrl: string, fileName: string) {
  const tabs = await tabsFromBytes(
    new Uint8Array(await readUpload(fileUrl)),
    fileName,
  );
  const tab =
    tabs.find((t) => t.rows.some((r) => r?.some((c) => c?.trim()))) ?? tabs[0];
  const rows = (tab?.rows ?? []).map((r) => r ?? []);
  const hi = Math.max(
    0,
    rows.findIndex((r) => r.filter((c) => c?.trim()).length >= 3),
  );
  return { header: rows[hi] ?? [], body: rows.slice(hi + 1) };
}

export async function previewAccuLynx(
  fileUrl: string,
  fileName: string,
  mapIn?: Partial<Record<AxField, number>>,
) {
  const { header, body } = await loadGrid(fileUrl, fileName);
  const map = mapIn ?? autoMap(header);
  const { rows, skipped } = readRows(body, map);
  const numbers = rows.map((r) => r.jobNumber).filter((x): x is string => !!x);
  const [byNumber, open] = await Promise.all([
    prisma.project.findMany({
      where: { acculynxJobNumber: { in: numbers } },
      select: { acculynxJobNumber: true },
    }),
    prisma.project.findMany({
      where: { acculynxJobNumber: null, address: { not: null } },
      select: { address: true },
    }),
  ]);
  const known = new Set(byNumber.map((p) => p.acculynxJobNumber));
  const addrs = new Set(open.map((p) => addrKey(p.address)));
  const milestones = [...new Set(rows.map((r) => r.milestone))].map((m) => ({
    value: m,
    count: rows.filter((r) => r.milestone === m).length,
    stage: milestoneStage(m),
  }));
  return {
    header,
    map,
    total: rows.length,
    skipped,
    updates: rows.filter((r) => r.jobNumber && known.has(r.jobNumber)).length,
    links: rows.filter(
      (r) =>
        !(r.jobNumber && known.has(r.jobNumber)) &&
        r.address &&
        addrs.has(addrKey(r.address)),
    ).length,
    milestones: milestones.sort((a, b) => b.count - a.count),
    sample: rows.slice(0, 8),
  };
}

type Actor = { id: string; name: string };

export async function importAccuLynx(
  opts: {
    fileUrl: string;
    fileName: string;
    map: Partial<Record<AxField, number>>;
    stages: Record<string, Stage | "SKIP">;
    market: "RESIDENTIAL" | "COMMERCIAL";
  },
  actor: Actor,
) {
  const { body } = await loadGrid(opts.fileUrl, opts.fileName);
  const { rows } = readRows(body, opts.map);
  const [users, companies] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true } }),
    prisma.company.findMany({ select: { id: true, name: true, type: true } }),
  ]);
  const userByName = new Map(
    users.map((u) => [u.name.trim().toLowerCase(), u.id]),
  );
  const r = {
    created: 0,
    updated: 0,
    linked: 0,
    unchanged: 0,
    skipped: 0,
    accountsCreated: 0,
    errors: [] as string[],
  };
  // jobs already in BTRpro without an AccuLynx number, by street address (schedule imports, jobs entered by hand)
  const byAddress = new Map<string, string>();
  for (const c of await prisma.project.findMany({
    where: { acculynxJobNumber: null, address: { not: null } },
    select: { id: true, address: true },
  }))
    if (addrKey(c.address)) byAddress.set(addrKey(c.address), c.id);
  for (const x of rows) {
    const stage =
      opts.stages[x.milestone] ?? milestoneStage(x.milestone) ?? "LEAD";
    if (stage === "SKIP") {
      r.skipped++;
      continue;
    }
    try {
      let companyId: string | null = null;
      if (x.company) {
        const m = matchAccount(x.company, companies);
        if (m.account) companyId = m.account.id;
        else {
          const c = await prisma.company.create({
            data: {
              name: x.company,
              type: opts.market === "COMMERCIAL" ? "GC" : "BUILDER",
              notes: "Created by the AccuLynx import",
            },
          });
          companies.push({ id: c.id, name: c.name, type: c.type });
          companyId = c.id;
          r.accountsCreated++;
        }
      }
      const salespersonId = x.salesperson
        ? (userByName.get(x.salesperson.trim().toLowerCase()) ?? null)
        : null;
      let existing = x.jobNumber
        ? await prisma.project.findFirst({
            where: { acculynxJobNumber: x.jobNumber },
          })
        : null;
      let linked = false;
      if (!existing && x.address && byAddress.has(addrKey(x.address))) {
        existing = await prisma.project.findUniqueOrThrow({
          where: { id: byAddress.get(addrKey(x.address))! },
        });
        byAddress.delete(addrKey(x.address));
        linked = true;
      }
      const note = `Imported from AccuLynx (${opts.fileName} row ${x.row})${x.milestone ? ` · milestone "${x.milestone}"` : ""}${x.salesperson && !salespersonId ? ` · salesperson ${x.salesperson} (no BTRpro user by that name)` : ""}`;
      if (existing) {
        const data: Record<string, unknown> = {};
        if (x.jobNumber && !existing.acculynxJobNumber)
          data.acculynxJobNumber = x.jobNumber;
        if (
          STAGE_RANK[stage] > STAGE_RANK[existing.status as Stage] &&
          existing.status !== "LOST"
        )
          Object.assign(data, { status: stage, statusChangedAt: new Date() });
        if (existing.contractAmount == null && x.amount != null)
          data.contractAmount = x.amount;
        if (!existing.clientCompanyId && companyId)
          data.clientCompanyId = companyId;
        if (!existing.salespersonId && salespersonId)
          data.salespersonId = salespersonId;
        if (!existing.leadSource && x.leadSource)
          data.leadSource = x.leadSource;
        if (!existing.claimNumber && x.claim)
          Object.assign(data, {
            isInsuranceClaim: true,
            claimNumber: x.claim,
            insuranceCarrier: existing.insuranceCarrier ?? x.carrier,
            dateOfLoss: existing.dateOfLoss ?? x.dateOfLoss,
          });
        if (!Object.keys(data).length) {
          r.unchanged++;
          continue;
        }
        await prisma.project.update({ where: { id: existing.id }, data });
        await prisma.projectActivity.create({
          data: {
            projectId: existing.id,
            userId: actor.id,
            kind: "import",
            text: `${linked ? "Linked to" : "Updated from"} AccuLynx job ${x.jobNumber ?? ""} — ${note}`,
          },
        });
        if (linked) r.linked++;
        else r.updated++;
        continue;
      }
      const p = await createProject(
        {
          name: x.name.slice(0, 200),
          market: opts.market,
          address: x.address,
          scopes: scopesFor(x.trade),
          isPublic: false,
          isTaxExempt: false,
          acculynxJobNumber: x.jobNumber,
          leadSource: x.leadSource ?? "AccuLynx import",
          clientCompanyId: companyId,
          salespersonId,
          isInsuranceClaim: !!(x.claim || x.carrier),
          insuranceCarrier: x.carrier,
          claimNumber: x.claim,
          dateOfLoss: x.dateOfLoss,
        },
        actor,
        x.contact,
      );
      await prisma.project.update({
        where: { id: p.id },
        data: {
          status: stage as never,
          statusChangedAt: x.created ?? new Date(),
          contractAmount: x.amount,
          ...(x.created ? { createdAt: x.created } : {}),
        },
      });
      await prisma.projectActivity.create({
        data: { projectId: p.id, userId: actor.id, kind: "import", text: note },
      });
      r.created++;
    } catch (e) {
      r.errors.push(
        `Row ${x.row} (${x.name}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return r;
}
