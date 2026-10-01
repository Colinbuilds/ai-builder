import { defineConfig } from "@playwright/test";

// End-to-end run against a production build on its own database (prisma/e2e.db) and upload folder.
const PORT = 3210;
const env = {
  DATABASE_URL: "file:./e2e.db",
  UPLOAD_DIR: "prisma/e2e-uploads",
  AUTH_SECRET: "TEST_ONLY-e2e-auth-secret",
  APP_URL: `http://localhost:${PORT}`,
};

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  workers: 1,
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1300, height: 950 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `${process.env.E2E_SKIP_BUILD ? "" : "npx next build && "}npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 300_000,
    reuseExistingServer: false,
    env,
  },
});
