# Estimating Pro

Roofing and exterior estimating app for BTR Contracting (Omaha, NE). The full spec is in [`BUILD_PROMPT.md`](BUILD_PROMPT.md). The estimator rules, which also become the AI system prompt, are in [`CLAUDE.md`](CLAUDE.md). The source-of-truth price data is in [`data/`](data/).

## Status

| Phase | What | State |
|---|---|---|
| 1 | Scaffold, auth (Admin / Estimator / Viewer), Prisma schema, seed from `/data`, price library browse/search | **Done** |
| 2 | Price sheet upload/parse (ZIP case), review/diff, date status, coverage parsing | **Done** |
| 3 | Projects, intake checklist, readiness, Form 17 | Next |
| 4 | Job communication: per-job chat, forwarding address + Gmail/M365 pull, email summaries, "Catch me up" | |
| 5–13 | Documents/extraction, calc engine, estimate builder, labor, rules, AI assistant, outputs, calibration, E2E | |

The full schema, including the job chat/email models, is already in `prisma/schema.prisma`. Later phases add features without reshaping the data model.

## Local setup

Requires Node 22.

```bash
cd estimating-pro
cp .env.example .env          # then set AUTH_SECRET (openssl rand -base64 32)
npm install                   # also runs prisma generate
npm run db:push               # creates prisma/dev.db (SQLite)
npm run db:seed               # 527 items / 6 sheets / 16 rules + the first admin user
npm run dev                   # http://localhost:3000
```

Sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `.env` (defaults: `admin@btrcontracting.local` / `change-me-now`). Change that password before any shared deploy. Add other users under **Users**.

The seed is safe to re-run. It updates existing sheets, items, and rules instead of duplicating them, and it never overwrites an existing admin.

## Price sheets (Phase 2)

- **Upload** (Admin, Sheets → Upload a sheet): accepts PDF, the ZIP-container "PDFs" ABC sends (detected by the `PK\x03\x04` signature, then the `.txt` files inside are read in page order), `.txt`, or a CSV in the `data/price_items.csv` layout.
- **Review**: every parsed row is editable. The page shows new, changed (with % price change), and removed items against the live version, rows whose description wrapped across lines, and any lines the parser skipped. Nothing goes live until you apply it. You can't apply without effective and expiration dates, unique item numbers, a UOM from the allowed list, and a price or CALL on every row.
- **Versions**: applying creates a new sheet version and keeps the old one under *Previous versions*. Coverage a user entered by hand carries over when the item's description and UOM didn't change. A sheet issued to an account other than 2057372-2 gets the "confirm account" warning automatically.
- **Date status** is checked against today in Omaha: EXPIRED (past expiration), EXPIRING (≤ 30 days left), STALE (effective > 90 days ago), CURRENT. Any sheet that isn't CURRENT shows in a banner on the dashboard, and every library row shows its sheet's status.
- **Coverage** is read from descriptions only when the pattern is explicit (`3/SQ`, `10SQ`, `31LF`, `116'4" LF`, `10'X100'`, `4X8` on sheet goods, `1M`, `5C`, `2000/BX`, a trailing `250` on boxes). Unit-less roll sizes like `9X50` are never read, because they are often inches. 186 of the 527 seeded items parse; the rest show `—` and can be entered on the item page (Admin/Estimator, logged to the audit trail).
- The seed never overwrites a sheet that was replaced by an upload, or coverage a user entered.
- Test fixtures in `test/fixtures/` are TEST_ONLY files generated from real rows in `data/`. Regenerate them with `node test/fixtures/make-fixtures.mjs`.

## Environment variables

| Name | Used for |
|---|---|
| `DATABASE_URL` | `file:./dev.db` locally; a Postgres URL in production |
| `AUTH_SECRET` | Signs session cookies. Required. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | First admin, created by the seed if missing |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | AI features (Phase 4+) |
| `STORAGE_DRIVER`, `UPLOAD_DIR` | File storage; `local` writes to `./uploads` (S3 arrives in Phase 5) |
| `INBOUND_EMAIL_*`, `GOOGLE_*`, `MS_*` | Job email capture (Phase 4) |

## Tests

```bash
npm test        # Vitest; builds a fresh prisma/test.db from /data and seeds it
npm run lint    # TypeScript typecheck
```

Covers acceptance tests 1–3 (seed counts, cap nail and coil nail lookups), 6 (coverage parser), and 8 (sheet date status), plus the upload → review → apply flow against the TEST_ONLY fixtures.

## Deploy (Vercel + Neon, or Railway)

1. In `prisma/schema.prisma`, change `provider = "sqlite"` to `"postgresql"`.
2. Set `DATABASE_URL` (Neon or Railway Postgres) and `AUTH_SECRET` in the host's environment.
3. Build command: `npx prisma db push && npm run build`. Run `npm run db:seed` once against the production database.

## Data rules baked into the app

- Prices, item numbers, and UOMs come only from `data/`. Nothing in code or tests invents them.
- CALL items have no price and show **CALL — get quote**.
- The Hardie Statement (HS) sheet shows a **Confirm account** warning wherever it's used.
- LP SmartSide exists as a sheet record with no items, so LP items stay MISSING until a sheet is uploaded.
