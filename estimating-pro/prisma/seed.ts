// Seeds the price library, company rules, and a first admin user from /data.
// Re-running is safe: sheets/items/rules are upserted, never duplicated.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";
import path from "node:path";

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

async function upsertSheet(code: string, data: Omit<Parameters<typeof prisma.priceSheet.create>[0]["data"], "code">) {
  const existing = await prisma.priceSheet.findFirst({ where: { code, isActive: true } });
  if (existing) return prisma.priceSheet.update({ where: { id: existing.id }, data });
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
    sheetIds[code] = sheet.id;
  }

  // LP SmartSide: record exists so the UI can show it, but no items until a sheet is uploaded.
  await upsertSheet("LP", {
    name: "LP SmartSide",
    scope: "LP SmartSide siding/panels (25LP…) and trim (31LPTW…)",
    warning: "No LP SmartSide price sheet loaded. LP items stay MISSING until a sheet is uploaded.",
    isLoaded: false,
  });

  for (const it of items) {
    const sheetId = sheetIds[it.sheet_code];
    if (!sheetId) throw new Error(`Item ${it.item_number} references unknown sheet ${it.sheet_code}`);
    const isCall = it.price_status !== "LISTED";
    const data = {
      section: it.section,
      description: it.description,
      unitPrice: isCall ? null : it.unit_price,
      uom: it.uom,
      priceStatus: isCall ? ("CALL" as const) : ("LISTED" as const),
    };
    await prisma.priceItem.upsert({
      where: { sheetId_itemNumber: { sheetId, itemNumber: it.item_number } },
      update: data,
      create: { sheetId, itemNumber: it.item_number, ...data },
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

  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@btrcontracting.local";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "change-me-now";
  if (!(await prisma.user.findUnique({ where: { email } }))) {
    await prisma.user.create({
      data: { name: "Admin", email, role: "ADMIN", passwordHash: await bcrypt.hash(password, 10) },
    });
    console.log(`Created admin user ${email}`);
  }

  const [sheetCount, itemCount, callCount, ruleCount] = await Promise.all([
    prisma.priceSheet.count({ where: { isLoaded: true, isActive: true } }),
    prisma.priceItem.count(),
    prisma.priceItem.count({ where: { priceStatus: "CALL" } }),
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
