import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

// Fresh throwaway database for the run (prisma/e2e.db), seeded from /data — same approach as the unit tests.
export default function globalSetup() {
  const root = path.resolve(__dirname, "..");
  rmSync(path.join(root, "prisma", "e2e.db"), { force: true });
  rmSync(path.join(root, "prisma", "e2e-uploads"), {
    recursive: true,
    force: true,
  });
  const env = {
    ...process.env,
    DATABASE_URL: "file:./e2e.db",
    AUTH_SECRET: "TEST_ONLY-e2e-auth-secret",
  };
  execSync("npx prisma db push --skip-generate", {
    cwd: root,
    env,
    stdio: "pipe",
  });
  execSync("npx tsx prisma/seed.ts", { cwd: root, env, stdio: "pipe" });
}
