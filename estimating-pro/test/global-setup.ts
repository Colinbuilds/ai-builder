import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

// Fresh SQLite test database, seeded from the real /data files.
export default function setup() {
  const root = path.resolve(__dirname, "..");
  rmSync(path.join(root, "prisma", "test.db"), { force: true });
  rmSync(path.join(root, "prisma", "test-uploads"), { recursive: true, force: true });
  const env = { ...process.env, DATABASE_URL: "file:./test.db" };
  execSync("npx prisma db push --skip-generate", { cwd: root, env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { cwd: root, env, stdio: "pipe" });
}
