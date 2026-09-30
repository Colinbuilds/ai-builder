import { defineConfig } from "prisma/config";

// With a config file, Prisma no longer reads .env on its own. Load it here for local dev;
// on Railway the variables come from the service settings and there is no .env file.
try {
  process.loadEnvFile();
} catch {
  // no .env — fine in production
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { seed: "tsx prisma/seed.ts" },
});
