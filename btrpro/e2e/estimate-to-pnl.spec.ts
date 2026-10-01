import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import path from "node:path";

// BUILD_PROMPT phase 19: create project → upload an EagleView-style PDF → confirm measurements →
// build a shingle estimate → export PDF → record costs → see the job P&L.
// Test data is TEST_ONLY. The AI read of the PDF is covered by unit tests with a fake client (no API key here),
// so this run records what the read would have queued, then a person confirms it in the UI.
const db = new PrismaClient({ datasources: { db: { url: "file:./e2e.db" } } });
test.afterAll(() => db.$disconnect());

const MEASURED = [
  ["roof_total_sf", 3240, "SF"],
  ["eaves_lf", 180, "LF"],
  ["rakes_lf", 120, "LF"],
  ["ridges_lf", 40, "LF"],
  ["hips_lf", 95, "LF"],
] as const;

test("estimate to job P&L", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", "admin@btrcontracting.local");
  await page.fill("#password", "change-me-now");
  await page.click("button[type=submit]");
  await expect(page.locator("h1")).toContainText("Dashboard");

  // Blueprint measurer lives under Production
  await page.goto("/takeoff");
  await expect(page.locator("h1")).toContainText("Blueprint measurer");
  await page.goto("/estimating/schedule?m=residential");
  await expect(page.locator("h1")).toContainText("Estimating schedule");

  // 1. New residential reroof
  // (lead form order: name → phone/email → address → job type → assigned to)
  await page.goto("/projects/new");
  await page.fill("input[name=hoFirstName]", "Erin");
  await page.fill("input[name=hoLastName]", "TEST_ONLY-E2E");
  await page.fill("input[name=hoPhone]", "402-555-0199");
  await page.fill("input[name=address]", "1 TEST_ONLY E2E St, Omaha NE");
  await page.keyboard.press("Escape");
  await page.locator("label:has(input[name=workTypes][value=REROOF])").click();
  await page.locator("button:has-text('Create job')").click();
  await page.waitForURL((u) => /\/projects\/[a-z0-9]{20,}$/.test(u.pathname));
  const projectId = page.url().split("/projects/")[1];

  // 2. Upload the EagleView-style PDF
  await page.goto(`/projects/${projectId}/documents`);
  await page.setInputFiles(
    "input[type=file][name=files]",
    path.join(__dirname, "../test/fixtures/TEST_ONLY_steep_slope.pdf"),
  );
  await page.locator("form:has(input[name=files]) button").click();
  await expect(page.locator("text=1 file added")).toBeVisible();
  const doc = await db.document.findFirstOrThrow({ where: { projectId } });
  for (const [key, value, unit] of MEASURED)
    await db.measurement.create({
      data: {
        projectId,
        key,
        value,
        extractedValue: value,
        unit,
        sourceDocId: doc.id,
        sourcePage: 1,
        quote: `TEST_ONLY ${key} ${value}`,
        status: "EXTRACTED_PENDING",
        note: "TEST_ONLY simulated AI read",
      },
    });

  // 3. Confirm each against the page
  await page.reload();
  for (let i = 0; i < MEASURED.length; i++) {
    await page.locator("button:has-text('Confirm')").first().click();
    await expect(page.locator("button:has-text('Confirm')")).toHaveCount(
      MEASURED.length - i - 1,
    );
  }
  await expect(page.locator("text=Total roof area").first()).toBeVisible();

  // 4. Shingle estimate from a template, then run the takeoff
  await page.goto(`/projects/${projectId}/estimates`);
  await page.selectOption("select[name=templateId]", {
    label: "Malarkey Vista AR",
  });
  await page.click("button:has-text('Start estimate with')");
  await page.waitForURL((u) => /\/estimates\/[a-z0-9]{20,}$/.test(u.pathname));
  const estimateId = page.url().split("/estimates/")[1];
  await page.locator("button:has-text('Save & calculate')").first().click();
  await expect(page.locator("text=lines calculated").first()).toBeVisible({
    timeout: 30_000,
  });
  const lines = await db.estimateLine.findMany({ where: { estimateId } });
  const coil = lines.find((l) => l.supplierItemNumber === "0150080011");
  expect(coil?.quantity).toBe(3); // 32.4 SQ × 1.05 = 34.02 SQ → ceil(34.02 / 15) = 3 BX (acceptance test 4)
  // ridge vent coverage is read from "Omniridge Pro 4'": 40 LF ridge ÷ 4 LF/PC = 10 PC
  expect(lines.find((l) => l.calcKey === "steep:ridge_vent")?.quantity).toBe(
    10,
  );

  // 5. Export the BTR estimate PDF
  const pdf = await page.request.get(
    `/api/estimates/${estimateId}/estimate.pdf`,
  );
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");

  // 6. Contract amount, then record a cost
  await db.project.update({
    where: { id: projectId },
    data: {
      status: "SOLD",
      contractAmount: 18000,
      contractSignedAt: new Date(),
    },
  });
  await page.goto(`/projects/${projectId}/costs`);
  const cost = page.locator("form:has(button:has-text('Add cost'))");
  await cost.locator("select[name=category]").selectOption("MATERIALS");
  await cost.locator("input[name=amount]").fill("6250.40");
  await cost.locator("input[name=vendor]").fill("ABC Supply #112");
  await cost
    .locator("input[name=description]")
    .fill("TEST_ONLY shingle delivery");
  await cost.locator("button:has-text('Add cost')").click();
  await expect(page.locator("text=TEST_ONLY shingle delivery")).toBeVisible();

  // 7. The P&L reflects it
  await page.reload();
  const body = await page.locator("body").innerText();
  expect(body).toContain("$18,000.00");
  expect(body).toContain("$6,250.40");
});
