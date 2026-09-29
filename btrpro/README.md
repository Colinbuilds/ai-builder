# BTRpro

Roofing and exterior estimating app for BTR Contracting (Omaha, NE). The full spec is in [`BUILD_PROMPT.md`](BUILD_PROMPT.md). The estimator rules, which also become the AI system prompt, are in [`CLAUDE.md`](CLAUDE.md). The source-of-truth price data is in [`data/`](data/).

## Status

| Phase | What | State |
|---|---|---|
| 1 | Scaffold, auth (Admin / Estimator / Viewer), Prisma schema, seed from `/data`, price library browse/search | **Done** |
| 2 | Price sheet upload/parse (ZIP case), review/diff, date status, coverage parsing | **Done** |
| 3 | Customers + projects with job workflow stages, intake checklist, readiness, Form 17 | **Done** |
| 4 | Job communication: per-job chat, forwarding address + Gmail/M365 pull, email summaries, "Catch me up" | **Done** |
| 5–11 | Documents/extraction, calc engine, estimate builder, labor, rules, AI assistant, outputs + proposals | |
| 12 | Job costing and profit analysis | |
| 13–18 | AccuLynx replacement: material orders, scheduling/crews, invoicing/payments/QuickBooks, tasks/reports/commissions, portal/mobile, migration | |
| 19 | End-to-end test | |

The full schema, including the job chat/email models, is already in `prisma/schema.prisma`. Later phases add features without reshaping the data model.

## Local setup

Requires Node 22.

```bash
cd btrpro
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

## Jobs and customers (Phase 3)

- **Customers:** companies (GC, owner, property manager, public agency…) and contacts. Homeowners are contacts without a company. New entries are checked for duplicates by email, phone (digits only), name, or company name (ignoring word order, punctuation, and Inc/LLC/Co); you can use the match or save anyway.
- **Jobs:** the dashboard lists open jobs by bid due date, with stage counts, readiness, and a Form 17 pending flag. The scopes picked on a job (steep, low-slope, deck, siding, panels) decide which of the 20 CLAUDE.md §4 intake fields apply. The rest are marked N/A automatically, and come back as MISSING if the scope changes. Address, building use, and new/reroof fill their intake fields directly.
- **Intake:** each field is Verified, Missing, Assumed, or N/A. An assumption needs a value plus the basis for it, and shows NOT FOR FINAL BID. Every change is on the job's activity timeline.
- **Readiness** is computed on every view, never set by hand:
  - NOT_READY: any relevant intake field MISSING, no estimate, estimate lines MISSING / CALL / PENDING_AI or priced from an EXPIRED sheet, missing labor, or any live sheet EXPIRED.
  - BUDGET: a number exists but rests on assumptions, placeholders, or unapproved waste.
  - BID_READY: nothing missing or assumed.
  
  "Why not bid ready?" lists each blocker with a link to fix it.
- **Stages:** Lead → Estimating → Submitted → Sold → Scheduled → In production → Complete → Invoiced → Paid → Closed, plus Lost. Gates:
  - Submitting a NOT_READY estimate needs an override with a reason (logged).
  - Sold needs a contract amount.
  - Scheduling needs a signed contract and, on public tax-exempt jobs, Form 17 executed. That gate can't be overridden (PUB-01).
  - Lost and backward moves need a reason.
- **Form 17:** public + tax-exempt jobs show a red banner until someone records the date Form 17 was executed with the owner.
- Viewers can read jobs but can't edit, and never see contract amounts.

## Residential and commercial

Every job is Residential or Commercial. The header switch (All / Residential / Commercial) filters the job list and sets the default for new jobs.
- **Residential:** homeowner as the primary contact (reused if the phone/email already exists), insurance claim fields (carrier, claim #, date of loss, adjuster, deductible), residential lead sources, steep-slope default.
- **Commercial:** client company, bid due date, public/tax-exempt with Form 17, prevailing wage, bid and P&P bonds, retainage, low-slope default.

## Job communication (Phase 4)

Each job has tabs: Overview, Team chat, Email, Documents, Estimates.
- **Team chat:** internal per-job thread with replies, edits, and @mentions (first name, full name, or email). It updates every 5 seconds. Unread counts and @mentions show on the dashboard and the job tab.
- **Email:** three ways in, de-duplicated by Message-ID, with attachments saved to the job:
  - **Forwarding address:** every job has one (`job-<token>@INBOUND_EMAIL_DOMAIN`). Point your inbound email provider's webhook (Postmark JSON or a generic JSON body) at `POST /api/inbound-email` with `x-webhook-secret: $INBOUND_EMAIL_WEBHOOK_SECRET`.
  - **Mailbox pull:** read-only Gmail / Microsoft 365. Each user connects their own mailbox, and tokens are encrypted at rest with AES-256-GCM. The default search is the claim #, AccuLynx #, or street address.
  - **Paste:** copy an email in by hand.
- **AI summaries:** each email gets a short summary with its asks and every stated figure, labeled "not verified". **Catch me up** writes a brief of the job (since you last looked, or the whole job) from the timeline, chat, email, intake gaps, and readiness blockers, and saves it with the time range it covers. All AI calls use CLAUDE.md as the system prompt, `claude-opus-5-5` (override with `ANTHROPIC_MODEL`), server-side refusal fallback (`fallbacks: "default"`), and treat a refusal as an error instead of saving partial output. Without `ANTHROPIC_API_KEY` the AI buttons are disabled; nothing is faked.

## Environment variables

| Name | Used for |
|---|---|
| `DATABASE_URL` | `file:./dev.db` locally; a Postgres URL in production |
| `AUTH_SECRET` | Signs session cookies. Required. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | First admin, created by the seed if missing |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | AI features (Phase 4+) |
| `STORAGE_DRIVER`, `UPLOAD_DIR` | File storage; `local` writes to `./uploads` (S3 arrives in Phase 5) |
| `INBOUND_EMAIL_DOMAIN`, `INBOUND_EMAIL_WEBHOOK_SECRET` | Job forwarding addresses and the inbound webhook |
| `APP_URL`, `GOOGLE_CLIENT_ID/SECRET`, `MS_CLIENT_ID/SECRET` | Mailbox connect (OAuth redirect is `APP_URL/api/mail/{google,microsoft}/callback`) |

## Tests

```bash
npm test        # Vitest; builds a fresh prisma/test.db from /data and seeds it
npm run lint    # TypeScript typecheck
```

Covers acceptance tests 1–3 (seed counts, cap nail and coil nail lookups), 6 (coverage parser), 8 (sheet date status), 11 (Form 17 banner), and 12 (readiness can't reach BID_READY with missing/placeholder/pending lines, unapproved waste, or an expired sheet), plus the upload → review → apply flow, stage gates, and intake relevance.

## Deploy (Vercel + Neon, or Railway)

1. In `prisma/schema.prisma`, change `provider = "sqlite"` to `"postgresql"`.
2. Set `DATABASE_URL` (Neon or Railway Postgres) and `AUTH_SECRET` in the host's environment.
3. Build command: `npx prisma db push && npm run build`. Run `npm run db:seed` once against the production database.

## Data rules baked into the app

- Prices, item numbers, and UOMs come only from `data/`. Nothing in code or tests invents them.
- CALL items have no price and show **CALL — get quote**.
- The Hardie Statement (HS) sheet shows a **Confirm account** warning wherever it's used.
- LP SmartSide exists as a sheet record with no items, so LP items stay MISSING until a sheet is uploaded.
