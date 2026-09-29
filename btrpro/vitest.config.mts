import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    globalSetup: ["test/global-setup.ts"],
    env: { DATABASE_URL: "file:./test.db" },
    fileParallelism: false,
  },
});
