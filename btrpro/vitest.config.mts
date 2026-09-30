import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    globalSetup: ["test/global-setup.ts"],
    // TEST_ONLY secret so encrypted-token tests run the same in CI as locally (never used outside tests).
    env: { DATABASE_URL: "file:./test.db", AUTH_SECRET: "TEST_ONLY-vitest-auth-secret" },
    fileParallelism: false,
  },
});
