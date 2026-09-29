# Estimating Pro

Roofing and exterior estimating app for BTR Contracting (Omaha, NE). The full spec is in [`BUILD_PROMPT.md`](BUILD_PROMPT.md). The estimator rules, which also become the AI system prompt, are in [`CLAUDE.md`](CLAUDE.md). The source-of-truth price data is in [`data/`](data/).

## Status

| Phase | What | State |
|---|---|---|
| 1 | Scaffold, auth (Admin / Estimator / Viewer), Prisma schema, seed from `/data`, price library browse/search | **Done** |
| 2 | Price sheet upload/parse (ZIP case), review/diff, date status | Next |
| 3 | Projects, intake checklist, readiness, Form 17 | |
| 4 | Job communication: per-job chat, email capture, email summaries, "Catch me up" | |
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

## Environment variables

| Name | Used for |
|---|---|
| `DATABASE_URL` | `file:./dev.db` locally; a Postgres URL in production |
| `AUTH_SECRET` | Signs session cookies. Required. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | First admin, created by the seed if missing |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | AI features (Phase 4+) |
| `STORAGE_DRIVER`, `S3_*` | Document storage (Phase 5) |

## Tests

```bash
npm test        # Vitest; builds a fresh prisma/test.db from /data and seeds it
npm run lint    # TypeScript typecheck
```

Phase 1 covers acceptance tests 1–3: the 527 / 6 / 8 CALL seed counts and the cap nail and coil nail lookups.

## Deploy (Vercel + Neon, or Railway)

1. In `prisma/schema.prisma`, change `provider = "sqlite"` to `"postgresql"`.
2. Set `DATABASE_URL` (Neon or Railway Postgres) and `AUTH_SECRET` in the host's environment.
3. Build command: `npx prisma db push && npm run build`. Run `npm run db:seed` once against the production database.

## Data rules baked into the app

- Prices, item numbers, and UOMs come only from `data/`. Nothing in code or tests invents them.
- CALL items have no price and show **CALL — get quote**.
- The Hardie Statement (HS) sheet shows a **Confirm account** warning wherever it's used.
- LP SmartSide exists as a sheet record with no items, so LP items stay MISSING until a sheet is uploaded.
