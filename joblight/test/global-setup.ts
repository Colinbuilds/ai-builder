import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

// Fresh SQLite test database for each run.
export default function setup() {
  const root = path.resolve(__dirname, "..");
  rmSync(path.join(root, "prisma", "test.db"), { force: true });
  execSync("npx prisma db push --skip-generate", { cwd: root, env: { ...process.env, DATABASE_URL: "file:./test.db" }, stdio: "pipe" });
}
