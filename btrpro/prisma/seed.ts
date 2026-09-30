// Seeds the price library, company rules, and a first admin user from /data.
// Re-running is safe: sheets/items/rules are upserted, never duplicated.
import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseCoverage } from "../src/lib/sheets/coverage";

const prisma = new PrismaClient();
const dataDir = path.join(__dirname, "..", "data");
const readJson = (f: string) => JSON.parse(readFileSync(path.join(dataDir, f), "utf8"));

type SheetMeta = {
  sheet_name: string;
  source_file: string;
  account: string;
  sales_rep: string;
  effective: string;
  expiration: string;
  scope: string;
  warning?: string;
};
type RawItem = {
  sheet_code: string;
  section: string;
  item_number: string;
  description: string;
  unit_price: number | null;
  uom: string;
  price_status: "LISTED" | "CALL FOR PRICE" | "CALL";
};
type RawRule = {
  id: string;
  locked: boolean;
  scope: string;
  rule: string;
  formula?: string;
  item_number?: string;
  [k: string]: unknown;
};

// The newest effective date wins. A sheet from /data never replaces a live version that is as new or newer
// (e.g. one an Admin uploaded or the Drive sync applied); a newer one becomes a new version and the old one
// is kept, inactive, for history. Returns null when the live version stays.
type SeedSheet = Omit<Prisma.PriceSheetUncheckedCreateInput, "code" | "importId">;
async function upsertSheet(code: string, data: SeedSheet) {
  const existing = await prisma.priceSheet.findFirst({ where: { code, isActive: true, companyId: null } });
  const eff = data.effectiveDate ? new Date(data.effectiveDate) : null;
  const newer = !!eff && (!existing?.effectiveDate || eff > existing.effectiveDate);
  if (existing && !newer) return existing.importId ? null : prisma.priceSheet.update({ where: { id: existing.id }, data });
  if (existing) await prisma.priceSheet.update({ where: { id: existing.id }, data: { isActive: false, replacedAt: new Date() } });
  return prisma.priceSheet.create({ data: { code, ...data } });
}

async function main() {
  const meta: Record<string, SheetMeta> = readJson("price_sheets_meta.json").sheets;
  const { items } = readJson("price_items.json") as { items: RawItem[] };

  const sheetIds: Record<string, string> = {};
  for (const [code, m] of Object.entries(meta)) {
    const sheet = await upsertSheet(code, {
      name: m.sheet_name,
      sourceFile: m.source_file,
      account: m.account,
      salesRep: m.sales_rep,
      effectiveDate: new Date(`${m.effective}T00:00:00Z`),
      expirationDate: new Date(`${m.expiration}T00:00:00Z`),
      scope: m.scope,
      warning: m.warning ?? null,
      isLoaded: true,
    });
    if (sheet) sheetIds[code] = sheet.id;
    else console.log(`Skipped ${code}: an uploaded version is live.`);
  }

  // LP SmartSide: record exists so the UI can show it, but no items until a sheet is uploaded.
  const lp = await prisma.priceSheet.findFirst({ where: { code: "LP", isActive: true } });
  if (!lp?.isLoaded) await upsertSheet("LP", {
    name: "LP SmartSide",
    scope: "LP SmartSide siding/panels (25LP…) and trim (31LPTW…)",
    warning: "No LP SmartSide price sheet loaded. LP items stay MISSING until a sheet is uploaded.",
    isLoaded: false,
  });

  for (const it of items) {
    if (!(it.sheet_code in meta)) throw new Error(`Item ${it.item_number} references unknown sheet ${it.sheet_code}`);
    const sheetId = sheetIds[it.sheet_code];
    if (!sheetId) continue; // sheet replaced by an upload
    const isCall = it.price_status !== "LISTED";
    const data = {
      section: it.section,
      description: it.description,
      unitPrice: isCall ? null : it.unit_price,
      uom: it.uom,
      priceStatus: isCall ? ("CALL" as const) : ("LISTED" as const),
    };
    const where = { sheetId_itemNumber: { sheetId, itemNumber: it.item_number } };
    const existing = await prisma.priceItem.findUnique({ where, select: { coverageSource: true } });
    // Parsed coverage never overwrites a value a user entered or took from manufacturer data.
    const keepCoverage = existing?.coverageSource && existing.coverageSource !== "PARSED_FROM_DESCRIPTION";
    const c = keepCoverage ? null : parseCoverage(it.description, it.uom);
    const coverage = keepCoverage
      ? {}
      : {
          coverageQty: c?.qty ?? null,
          coverageUnit: c?.unit ?? null,
          coverageSource: c ? ("PARSED_FROM_DESCRIPTION" as const) : null,
        };
    await prisma.priceItem.upsert({
      where,
      update: { ...data, ...coverage },
      create: { sheetId, itemNumber: it.item_number, ...data, ...coverage },
    });
  }

  const { rules } = readJson("company_rules.json") as { rules: RawRule[] };
  for (const r of rules) {
    const { id, locked, scope, rule, formula, item_number, ...extra } = r;
    const data = {
      scope,
      text: rule,
      formula: formula ?? null,
      itemNumber: item_number ?? null,
      extra: Object.keys(extra).length ? (extra as object) : undefined,
      locked,
    };
    await prisma.rule.upsert({ where: { id }, update: data, create: { id, ...data } });
  }

  // Emails are stored lowercase (login lowercases what's typed). Trim stray spaces/quotes from the Railway variable.
  const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, "").trim() || undefined;
  const email = (clean(process.env.SEED_ADMIN_EMAIL) ?? "admin@btrcontracting.local").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "change-me-now";
  // Older versions stored emails as typed; fix any with capitals so they can sign in.
  for (const u of await prisma.user.findMany({ select: { id: true, email: true } }))
    if (u.email !== u.email.trim().toLowerCase() && !(await prisma.user.findUnique({ where: { email: u.email.trim().toLowerCase() } })))
      await prisma.user.update({ where: { id: u.id }, data: { email: u.email.trim().toLowerCase() } });
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    if (process.env.NODE_ENV === "production" && (!process.env.SEED_ADMIN_PASSWORD || password.length < 12))
      throw new Error("Set SEED_ADMIN_PASSWORD (12+ characters) before the first production start.");
    await prisma.user.create({
      data: { name: "Admin", email, role: "ADMIN", passwordHash: await bcrypt.hash(password, 10) },
    });
    console.log(`Created admin user ${email}`);
  } else if (process.env.RESET_ADMIN_PASSWORD === "true") {
    // Locked out: set RESET_ADMIN_PASSWORD=true, redeploy, sign in, then delete the variable.
    if (!process.env.SEED_ADMIN_PASSWORD || password.length < 12) throw new Error("RESET_ADMIN_PASSWORD needs SEED_ADMIN_PASSWORD (12+ characters).");
    await prisma.user.update({ where: { id: existing.id }, data: { passwordHash: await bcrypt.hash(password, 10), role: "ADMIN" } });
    console.log(`Reset the password for ${email}. Remove RESET_ADMIN_PASSWORD now.`);
  }
  if (process.env.NODE_ENV === "production") {
    const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { email: true } });
    console.log(`Admin sign-ins: ${admins.map((a) => a.email).join(", ")}`);
  }

  // Built-in estimate templates (product systems). Created once; later edits in the app are kept.
  const tplFile = path.join(dataDir, "estimate_templates.json");
  if (existsSync(tplFile)) {
    const { templates } = JSON.parse(readFileSync(tplFile, "utf8")) as { templates: { key: string; config: object; [k: string]: unknown }[] };
    let added = 0;
    for (const t of templates) {
      if (await prisma.estimateTemplate.findUnique({ where: { key: t.key } })) continue;
      await prisma.estimateTemplate.create({
        data: { key: t.key, name: String(t.name), category: String(t.category), group: String(t.group), brand: (t.brand as string) ?? null, impactClass: (t.impactClass as string) ?? null, impactSource: (t.impactSource as string) ?? null, scopeType: String(t.scopeType), module: String(t.module), config: t.config as Prisma.InputJsonValue, notes: (t.notes as string) ?? null, builtIn: true, createdBy: "BTRpro starter set" },
      });
      added++;
    }
    if (added) console.log(`Added ${added} built-in estimate templates.`);
  }

  // BTR company data from their Drive (labor piece rates, crews/subs, companies). Created once; edits in the app are kept.
  const coFile = path.join(dataDir, "btr_company_data.json");
  if (existsSync(coFile)) {
    const co = JSON.parse(readFileSync(coFile, "utf8")) as {
      laborStandards: { seedKey: string; category: string; task: string; unit: string; unitRate: number; source: string }[];
      crews: { name: string; leadName: string; trade: string; notes?: string }[];
      companies: { name: string; type: string }[];
    };
    let n = 0;
    for (const l of co.laborStandards) {
      if (await prisma.laborStandard.findFirst({ where: { seedKey: l.seedKey } })) continue;
      await prisma.laborStandard.create({ data: { ...l, rateType: "UNIT", enteredBy: "BTR Drive import" } });
      n++;
    }
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
    const crewNames = new Set((await prisma.crew.findMany({ select: { name: true } })).map((c) => norm(c.name)));
    for (const c of co.crews)
      if (!crewNames.has(norm(c.name))) {
        // insurance dates aren't in the files: they show as missing until entered
        await prisma.crew.create({ data: { name: c.name, kind: "SUB", leadName: c.leadName, trade: c.trade, notes: c.notes ?? "From BTR's Drive files. Add phone, email, pay, and insurance dates." } });
        n++;
      }
    const coNames = new Set((await prisma.company.findMany({ select: { name: true } })).map((c) => norm(c.name)));
    for (const c of co.companies)
      if (!coNames.has(norm(c.name))) {
        await prisma.company.create({ data: { name: c.name, type: c.type as never, notes: "From BTR's Drive files (estimating schedule / job list)." } });
        n++;
      }
    if (n) console.log(`Added ${n} records from BTR company data.`);
  }

  const active = { sheet: { isActive: true, companyId: null } };
  const [sheetCount, itemCount, callCount, ruleCount] = await Promise.all([
    prisma.priceSheet.count({ where: { isLoaded: true, isActive: true, companyId: null } }),
    prisma.priceItem.count({ where: active }),
    prisma.priceItem.count({ where: { priceStatus: "CALL", ...active } }),
    prisma.rule.count(),
  ]);
  console.log(`Seeded ${itemCount} items across ${sheetCount} sheets (${callCount} CALL), ${ruleCount} rules.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
