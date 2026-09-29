# BTRpro

The system BTR Contracting (Omaha, NE) runs the company on: jobs and customers, estimating, job communication, documents, and (as the phases land) ordering, scheduling, invoicing, and job costing, on both the residential and commercial sides. The full spec is in [`BUILD_PROMPT.md`](BUILD_PROMPT.md). The estimator rules, which also become the AI system prompt, are in [`CLAUDE.md`](CLAUDE.md). The source-of-truth price data is in [`data/`](data/).

## Status

| Phase | What | State |
|---|---|---|
| 1 | Scaffold, auth (Admin / Estimator / Viewer), Prisma schema, seed from `/data`, price library browse/search | **Done** |
| 2 | Price sheet upload/parse (ZIP case), review/diff, date status, coverage parsing | **Done** |
| 3 | Customers + projects with job workflow stages, intake checklist, readiness, Form 17 | **Done** |
| 4 | Job communication: per-job chat, forwarding address + Gmail/M365 pull, email summaries, "Catch me up" | **Done** |
| 5 | Documents, EagleView/plan extraction, confirmation queue, Google Drive import, Integrations page | **Done** |
| 6 | Calc engine: steep, low-slope, deck, siding, pricing & totals (pure TypeScript, unit-tested) | **Done** |
| 7–9 | Estimate builder, labor + standards library, rules engine | **Done** |
| 10 | AI estimator assistant (tools, validation, quick actions) | **Done** |
| 11 | Outputs (AccuLynx copy, order CSV, estimate & takeoff PDFs) + customer proposals with e-signature | Next |
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

## Documents and measurements (Phase 5)

- **Documents tab:** drag-and-drop upload (50 MB per file), Google Drive import from a file or folder link, and email attachments all land here. Each file gets a first-guess type (EagleView, plans, specs, manufacturer data, sub proposal, change order, photo); change it from the list.
- **Read with AI:**
  - EagleView reports → measurements. Plans and specs → roof system, insulation, warranty, edge metal, deck type, Div. 07/08 spec sections, and roof area.
  - Claude reads the PDF itself. Every value must cite a page in the file and the text it came from; values without one are dropped and reported.
  - **ROOF-01:** a roof area that came from a floor-plan area schedule is rejected with an explanation and a red banner.
- **Confirmation queue:** each extracted value sits next to the PDF opened at its source page. Confirm, edit and confirm (the AI's reading is kept for the record), or reject. Only confirmed or hand-entered measurements count.
  - Confirmed values fill the matching intake fields as Verified, citing file and page (roof area, pitch, penetrations, curbs, skylights, building height, wall heights, roof system, and the rest), and readiness updates.
  - Hand entries need a source (sheet and page, or who field-measured).
- **SID-01:** on siding jobs the tab shows the siding area used (the EagleView Siding category only) and the masonry area/corners excluded from siding math.
- **Storage:** `STORAGE_DRIVER=local` for development. Use `s3` in production (AWS S3, Cloudflare R2, or Backblaze B2 via `S3_ENDPOINT`).
- **Settings → Integrations** (Admin): status, needed keys, and fallback for Claude, job email, Gmail/M365, Google Drive, QuickBooks Online, Procore, Buildertrend, EagleView, ABC Supply, CompanyCam, and file storage. Connections use OAuth, with tokens encrypted at rest.

## Estimating (Phases 6–9)

- **Calc engine** (`src/lib/calc`) is pure TypeScript with unit tests; the AI never does arithmetic. Every line stores a readable formula (e.g. `ceil(32.4 SQ × 1.05 × 3 BD/SQ) = 103 BD`) and its inputs. Any missing measurement, coverage, or product leaves the line MISSING.
- **Takeoff** per module (steep, low-slope, deck, siding): pick products from the live sheets, and coverage fills in only from explicit description patterns in the right unit (otherwise you enter it). Fastening patterns, I&W rows, flashing allowances, and exposures are always entered from the spec or manufacturer data. Measurements come only from confirmed/entered values.
- **Company rules** are built into the math: nails at 1 BX/15 SQ, cap nails always, ridge vent always, starter on eaves + rakes, H&R at 25 LF/BD, EPDM cover board, pre-securement on pre-secured EPDM, SID-01 siding area, 8.25" HardiePlank default, and the cheapest wrap on the sheet. The rules panel shows pass/fail with a one-click fix; Admins edit rules under **Rules** (logged).
- **Units:** when the takeoff unit differs from how the sheet sells an item, only the item's printed relationship is used (e.g. 103 BD ÷ 3 BD/SQ = 34.33 SQ, "Order 103 BD"). Any other mismatch stays unpriced.
- **Waste gate:** residential roofing/siding default 5% (pre-approved); anything else shows the reference range and needs approval. Residential waste other than 5% needs an Admin.
- **Lines:** `Item | Supplier Material # | Quantity | Unit | Unit Cost | Total | Source/Status`, with green/amber/red/blue status. Unknown item numbers are MISSING_ITEM. General conditions and non-sheet items need a price source. Placeholders are labeled NOT FOR FINAL BID. **Substitute (requires approval)** and quantity overrides need a reason and are logged.
- **Revisions:** "Create next revision" copies and locks the previous one. Compare shows quantity/price/total changes.
- **Labor:** hours = qty ÷ production rate; cost = hours × $/hr × (1 + burden). Rates come from the **Labor standards** library (starts empty), a stated source, or an approved placeholder.
- **Totals:** materials, general conditions, labor, contingency, and grand total. Lines without a number are excluded, and the estimate is flagged INCOMPLETE.

## AI estimator assistant (Phase 10)

The **AI assistant** tab on each job is a streaming chat with a shared per-job history (Admins/Estimators).
- **Tools:** Claude works through tools (search price items, get item, measurements, intake, sheet status, run the calculator, propose lines, open items, job chat/email, list/read documents, propose scope) rather than raw data. It sees only prices and item numbers the tools return.
- **Proposed lines** land on the estimate as **AI suggestion** (PENDING_AI) with no total, and count only after a person clicks Accept (which re-checks the sheet). The server rejects any proposal whose item number isn't on a sheet or whose price or UOM doesn't match (acceptance test 10).
- **Quick actions:** Start project, What's missing?, Review change order, Compare sub proposals, Write scope.
- **Every request** carries CLAUDE.md as the system prompt plus a live job snapshot, uses adaptive thinking at high effort with server-side refusal fallback, validates each tool input before running it, and stops cleanly on a refusal or a truncated tool call.

## Environment variables

| Name | Used for |
|---|---|
| `DATABASE_URL` | `file:./dev.db` locally; a Postgres URL in production |
| `AUTH_SECRET` | Signs session cookies. Required. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | First admin, created by the seed if missing |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | AI features (Phase 4+) |
| `STORAGE_DRIVER`, `UPLOAD_DIR`, `S3_*` | File storage: `local` (dev) or `s3` (`S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) |
| `QBO_CLIENT_ID/SECRET`, `PROCORE_CLIENT_ID/SECRET` | QuickBooks Online and Procore connections |
| `EAGLEVIEW_CLIENT_ID/SECRET`, `ABC_CLIENT_ID/SECRET`, `COMPANYCAM_TOKEN` | Set when those vendors grant BTR API access |
| `INBOUND_EMAIL_DOMAIN`, `INBOUND_EMAIL_WEBHOOK_SECRET` | Job forwarding addresses and the inbound webhook |
| `APP_URL`, `GOOGLE_CLIENT_ID/SECRET`, `MS_CLIENT_ID/SECRET` | Mailbox connect (OAuth redirect is `APP_URL/api/mail/{google,microsoft}/callback`) |

## Tests

```bash
npm test        # Vitest; builds a fresh prisma/test.db from /data and seeds it
npm run lint    # TypeScript typecheck
```

Covers acceptance tests 1–9 (seed counts, item lookups, 32.4 SQ nails, 25 LF/BD hip & ridge, coverage parser, SID-01 siding area, sheet date status, MISSING_ITEM totals), 11 (Form 17 banner), and 12 (readiness can't reach BID_READY with missing/placeholder/pending lines, unapproved waste, or an expired sheet), plus the upload → review → apply flow, stage gates, and intake relevance.

## Deploy (Railway — simplest)

BTRpro ships with a `Dockerfile` and `railway.json`. SQLite and uploaded files live on a persistent volume, so there's no separate database to set up.

1. In Railway: **New Project → Deploy from GitHub repo →** `colinbuilds/ai-builder`, branch `claude/gracious-fermat-v8y4oh` (or `main` once merged).
2. Service **Settings → Root Directory:** `btrpro`.
3. **Add a Volume** mounted at `/data`.
4. **Variables:**
   - `AUTH_SECRET`: a long random string (`openssl rand -base64 32`).
   - `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`: the first admin login. The password must be 12+ characters; production refuses to start with the default.
   - `APP_URL`: the public URL from step 5.
   - Optional: `ANTHROPIC_API_KEY` for the AI features, plus any integration keys from `.env.example`.
5. **Settings → Networking → Generate Domain.** Open it and sign in.

Each start runs `prisma db push` (schema), then the idempotent seed (price sheets, rules, first admin), then the server. The same image runs on Render or Fly.io: mount a disk at `/data` and set the same variables.

For larger teams, move to Postgres: change `provider` in `prisma/schema.prisma` to `postgresql`, set `DATABASE_URL`, and set `STORAGE_DRIVER=s3` for files.

## Data rules baked into the app

- Prices, item numbers, and UOMs come only from `data/`. Nothing in code or tests invents them.
- CALL items have no price and show **CALL — get quote**.
- The Hardie Statement (HS) sheet shows a **Confirm account** warning wherever it's used.
- LP SmartSide exists as a sheet record with no items, so LP items stay MISSING until a sheet is uploaded.
