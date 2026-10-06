import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src"), "server-only": path.resolve(import.meta.dirname, "test/server-only.ts") } },
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    // TEST_ONLY values, never used outside tests
    env: { DATABASE_URL: "file:./test.db", AUTH_SECRET: "TEST_ONLY-joblight-auth-secret-0123456789", CONSOLE_EMAIL: "test-only-op@example.com", CONSOLE_PASSWORD: "TEST_ONLY-password-123" },
    fileParallelism: false,
  },
});
