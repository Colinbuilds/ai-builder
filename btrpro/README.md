# BTRpro

The system BTR Contracting (Omaha, NE) runs the company on: jobs and customers, estimating, job communication, documents, ordering, scheduling, crews, invoicing, and job costing, on both the residential and commercial sides. The full spec is in [`BUILD_PROMPT.md`](BUILD_PROMPT.md). The estimator rules, which also become the AI system prompt, are in [`CLAUDE.md`](CLAUDE.md). The source-of-truth price data is in [`data/`](data/).

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
| 11 | Outputs (material list, order CSV, estimate & takeoff PDFs) + customer proposals with e-signature | **Done** |
| 12 | Job costing and profit analysis | **Done** |
| 13 | Material orders and deliveries | **Done** |
| 14 | Schedule, crews & subs, work orders, timesheets | **Done** |
| 15 | Invoicing, payments, AR aging, change orders with e-signature, QuickBooks push, Stripe card payments | **Done** |
| 16 | Tasks and reminders (My day), sales & pipeline dashboard, commission calculator | **Done** |
| 17 | Customer portal, crew phone link, CompanyCam photos, EagleView order tracking | **Done** |
| 18 | AccuLynx migration (one-time jobs export import) and setup checklist | **Done** |
| 19 | Playwright end-to-end test: job → PDF upload → confirm measurements → shingle estimate → PDF → costs → P&L | **Done** |
| 20 | AccuLynx-style interface: icon toolbar with dropdowns, dashboard (pipeline, action items, activity feed, leaderboard, work schedule, AR), job header with milestones + Advance Job + Job Menu, notifications panel, company updates, watch list; job Photos tab from the CompanyCam folders in Drive | **Done** |
| 21 | Receipt scanner (photo → job match → price check vs every sheet incl. builder pricing → job costs); crew portal login (invoices + required job photos only) with office review | **Done** |

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
- **Coverage** is read from descriptions only when the pattern is explicit (`3/SQ`, `10SQ`, `31LF`, `116'4" LF`, `10'X100'`, `4X8` on sheet goods, `1M`, `5C`, `2000/BX`, a trailing `250` on boxes, one length in feet on pieces such as `Omniridge Pro 4'` or `12' J-Channel`). Unit-less roll sizes like `9X50` are never read, because they are often inches. 228 of the 527 seeded items parse; the rest show `—` and can be entered on the item page (Admin/Estimator, logged to the audit trail).
- The seed never overwrites a sheet that was replaced by an upload, or coverage a user entered.
- Test fixtures in `test/fixtures/` are TEST_ONLY files generated from real rows in `data/`. Regenerate them with `node test/fixtures/make-fixtures.mjs`.

## Jobs and customers (Phase 3)

- **Customers:** companies (GC, owner, property manager, public agency…) and contacts. Homeowners are contacts without a company. New entries are checked for duplicates by email, phone (digits only), name, or company name (ignoring word order, punctuation, and Inc/LLC/Co); you can use the match or save anyway.
- **Properties and staff directories:** a property manager's communities (or any customer's sites) are **properties** on the customer page, each with its own address, office phone/email and site staff. **Import staff directory** (customer page or Customers list) takes the company's directory as a PDF, Word file or photo; the AI transcribes it exactly as printed (no invented area codes or people), you preview it, then import. Re-importing a newer directory updates people (matched by email, then name, then cell + last name; never phone alone) and properties (by name), adds new ones, and lists who's no longer in it without deleting anyone. Office staff and regional managers stay on the company; site staff go on their property. Picking a property on a new job fills the address and adds that site's staff as job contacts. Directories hold personal contact info, so they're uploaded to the live app, never committed to the repo.
- **New job / lead form** follows how a call comes in: first/last name → phone/email → address → job type (Reroof, New con roof, Siding, Gutters, Insulation, Windows, Repair, Warranty — pick all that apply) → assigned to. Market, client company/property, lead source, priority, first appointment, insurance claim and notes are under "More details". The job is named "First Last — Reroof, Gutters" (editable later); roof types set the estimating scope (steep on residential, low-slope on commercial) and new-vs-reroof; siding sets the siding scope.
- **Address lookup:** address boxes suggest matches as you type (↑/↓/Enter or click), Omaha-area first. 📍 fills the address where you're standing. Set `GOOGLE_MAPS_API_KEY` (Places API (New)) for exact house-level suggestions; without it, OpenStreetMap suggestions keep the house number you typed but the ZIP should be checked.
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
  - **Mailbox pull:** read-only Gmail / Microsoft 365. Each user connects their own mailbox, and tokens are encrypted at rest with AES-256-GCM. The default search is the claim #, old AccuLynx job #, or street address.
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

## Outputs and proposals (Phase 11)

- **Estimate outputs**: each estimate has links for the copy-paste material list (item, qty, unit), the ABC order CSV, the BTR estimate PDF, and the internal takeoff PDF (formulas, sources, MISSING items in red).
- **Company settings** (Settings → Company): markup, sales tax, deposit %, proposal terms, warranty text, and how long proposals stay valid. Anything blank stays blank; nothing is filled in for you.
- **Proposals**: made from a finished estimate. The estimate must be complete, have a written scope ("We will" lines), and have terms plus a markup set. A NOT READY job needs an explicit checkbox. Price = (cost + tax on materials) × (1 + markup), and the breakdown is shown. Optional add-ons can be offered.
- **E-signature**: "Send" emails the customer a private link (Postmark), or you copy the link yourself. The customer picks add-ons, signs with a finger or mouse, and consents. Signing records name, email, IP, and time; sets the contract amount; moves the job to Sold; and files the signed PDF in Documents.

## Job costing and profit (Phase 12)

Each job has a **Job costing** tab. Admins see every job. Estimators see the jobs where they're the estimator or salesperson, plus unassigned jobs. Viewers never see it.

- **Baseline:** when a customer signs a proposal, that estimate is frozen as the job's estimated cost. You can also freeze one by hand. Replacing it is Admin-only, needs a reason, and is logged.
- **Actual costs:** bills, receipts, and credits by category, with an optional photo or PDF. Crew hours are entered as hours × rate × burden, and the formula is shown. Supplier invoice CSVs (myABCsupply or others) can be imported:
  - You preview first and can filter by PO.
  - Nothing is imported twice.
  - Lines billed at a different price than the price sheet are flagged.
- **Committed costs:** open orders and accepted sub proposals, so margin is projected rather than only to-date. Linking a bill to a commitment reduces what's still committed.
- **Change orders and supplements:** only approved ones count toward revenue. Credits subtract.
- **P&L:** revenue, estimated/actual/projected cost, gross profit and margin, overhead, and net profit (gross profit − overhead). Commissions are not in the job P&L; use the commission calculator.
  - A category over estimate by the company threshold is flagged red.
  - A number that can't be calculated shows MISSING and says why. Overhead and the threshold start empty in Settings → Company.
- **Close-out:** every category needs a bill or a "none expected" mark, with no open commitments or pending change orders. Closing then locks the final P&L. After that, changes are Admin-only and audit-logged.
- **Profit report (nav → Profit):**
  - Filters: date, side, job type, public/private, salesperson, estimator, and GC.
  - Shows $/SQ and $/SF sold vs. cost, and estimate accuracy by bucket for closed jobs.
  - Also shows public bid tabs (rank, % over low, money left on the table).

## Material orders and deliveries (Phase 13)

- **Orders tab on each job.** "New material order" copies the estimate's material lines: same item numbers and quantities, with shingles converted to whole bundles through the item's printed coverage (for example 34.33 SQ × 3 BD/SQ = 103 BD). You can change quantities and add lines from the price sheets while it's a draft.
- **Before sending**, the order needs a delivery date, drop location, and on-site contact, and no MISSING quantities. On a public tax-exempt job it can't go out until the Form 17 is executed (PUB-01).
- **Sending**
  - Emails the order PDF to the branch (set the order email under Admin → Company settings). You can also download the PDF and click "Mark as sent".
  - Files the PDF on the job.
  - Adds the priced total to committed cost in Job costing.
- **After sending**
  - Record the branch confirmation (ABC order # and date).
  - Receive deliveries against the ticket, with a photo; short lines become dated backorders.
  - Record returns, which lower the committed cost.
  - Cancel with a reason.
- **Job costing link:** imported invoices carrying the PO (or ABC's order #) bill that order's commitment automatically.
- **Operations → Deliveries:** every open order across jobs by date, with overdue orders flagged and backorders listed.
- The ABC ordering API is not connected; that needs ABC to grant access.

## Production (Phase 14)

- **Operations → Crews & subs:** crew and sub records with default pay (hourly + burden, or piece rate per SQ/SF/LF).
  - Insurance tracking: subs need a current COI and workers' comp on file. Expiring (≤30 days), expired, and missing insurance show up everywhere the crew is picked.
- **Operations → Schedule:** a two-week board of installs, tear-offs, inspections, dumpster swaps, and repairs, plus material deliveries from orders. Filter by crew.
  - Double-booking a crew, or scheduling a sub without current insurance, needs a stated reason. The reason is kept, and the event shows amber instead of red.
  - Putting an install on a sold job moves it to Scheduled. The stage gates apply: a signed contract, and the Form 17 on public tax-exempt jobs.
- **Job → Production tab:** the job's schedule, its work orders, and its time.
  - **Work orders:** pull the "We will / We will not" scope from the estimate and add instructions, a start date, and pay (piece or lump sum; hourly crews use timesheets).
    - A work order can't be sent to a sub whose insurance isn't current.
    - Sending emails the crew a link (or you text it) and adds the pay to committed cost.
    - The link (`/w/…`, no login) shows the crew the address with a Maps link, the customer contact, dates, scope, materials and delivery status, and their own pay. They can tap "Started" / "Job complete".
  - **Time & piece work:** logged per crew per day. Approving it posts it to Job costing (labor for crews, subcontractors for subs) and bills the crew's work order.

## Builders and builder pricing

Home builders often have their own negotiated ABC pricing. **Builders** (top menu) holds each one with tabs:
- **Pricing:** their price sheets. Upload the PDF ABC gave them, or a CSV ([template](/api/builders/template.csv)); you review it like any BTR sheet. You can also search their items there.
- **Jobs:** every job for that builder, plus "New job" with the builder preselected.
- **Contacts:** superintendents, purchasing, AP.
- **Builder info:** ABC account, sheet prefix (their sheets are coded `PREFIX-XX`), standard specs, billing terms, and whether a PO is required.

How prices are picked:
- A job whose client is a builder is priced from **that builder's sheets only**. This applies to takeoffs, added lines, substitutions, the item search, the AI assistant, material orders, and invoice price checks.
- For an item that isn't on the builder's sheets, each builder has a required setting: use BTR's standard price with the line flagged "not on builder pricing", or leave it MISSING.
- Builder prices never appear on any other job or in the main price library.
- If a job's client changes after it was priced, the estimate warns which lines were priced under the old pricing.

## Estimate templates (product systems)

**Estimating → Estimate templates.** Ready-made product systems built from the loaded sheets. Pick one when you start an estimate, or apply it on the estimate page.
- **Shingles:** Malarkey, IKO, Tamko, Atlas, CertainTeed, GAF, and Owens Corning.
  - Each system includes the brand's starter, hip & ridge, underlayment, and ice & water where the sheet has them, plus ridge vent, drip edge, step flashing, and pipe boots.
  - Split into **Class 4 / impact-resistant** (only where the sheet says IR, Impact, or Class 4) and **rating not on sheet**. An Admin can set Class 3 or Class 4 on a template once a source (spec sheet or UL 2218 listing) is entered.
- **Flat roof:**
  - Mulehide EPDM .060 fully adhered, Mulehide EPDM .060 pre-secured, and Mulehide TPO .060 mechanically attached.
  - Elevate EPDM and Elevate TPO.
  - Cover board is always on EPDM, and pre-securement is included on pre-secured systems.
- **Siding:**
  - Hardie Primed (Cedarmill / Smooth 8.25"), Hardie Statement, and Norandex vinyl (Summit Manor, Woodsman, Cedar Knolls, Great Barrier, Board & Batten).
  - Vinyl is quantified by the square.
  - LP SmartSide stays MISSING until an LP sheet is loaded.

Templates only choose products. Quantities still come from confirmed measurements, and prices from the live sheets (or the builder's sheets on builder jobs). Notes on each template call out anything to confirm.

To make your own template, set up products on an estimate and click "Save these product picks as a template".

## BTR data loaded from Google Drive

`data/btr_company_data.json` is loaded on every start. It only creates what's missing, so edits made in the app are kept. Contents:
- **33 labor piece rates** with their source file:
  - Roofing: tear-off & install $90/SQ, height charge $7.50/SQ, and 750 vents $12.50/EA, from the "Labor pricing" screenshot.
  - Siding: 26 rates from the Residential Price Book 4/29/26 (Hardie/LP lap, shingles, B&B, tear-off, wrap, trim, garage doors…).
  - Gutters: 4 rates from the Price Book Gutters tab.
- **6 crews/subs** from the jobs & commissions sheet: Arne's Innovation, D&I Creations, Betos Construction, ERZ Exteriors, ONIX Construction, Jorge. Insurance shows missing until dates are entered.
- **28 companies:**
  - 17 GCs, e.g. Brester, Overland, Perry Reid, Pedcore, Lund Ross, Ronco, Sampson.
  - 3 property managers: Broadmoor, Richdale, Asset Living.
  - 8 builders: DR Horton Omaha/KC, Hildy, Drake, Blake, Bridgewater, Sharf, Echelon. Each builder asks you to choose its pricing fallback before its jobs are priced.

Business names only; no customer emails or addresses are stored in the repository.

Labor standards can now be **piece rates** ($ per SQ/LF/EA, how crews and subs are paid) as well as hourly production rates.

## Price sheets stay current from Google Drive

BTRpro watches the Drive folder where ABC price sheets are dropped (Unit Pricing Sheets → **Current**).
- **When it checks:** on start, every 6 hours, and when you click **Check now** (Estimating → Price sheets).
- **Matching:** each new or updated file is matched to its sheet by name: Steep slope → SS, Mulehide → MH, Elevate → EL, Statement → HS, Primed/Hardie → HP, NDX/Norandex/Vinyl → NX, SmartSide/LP → LP, Central States → CSM.
- **Reading:** it's read with the same parser as a manual upload, including ABC's two-column layout.
- **Goes live on its own** when it reads cleanly and is **newer** than the live sheet. The old version is kept under Previous versions, and open estimates pick up the new prices when their takeoff is re-run.
- **Held for review** (shown on the Price sheets page with the reason) when:
  - dates are missing, or rows can't be read;
  - more than 20% of live items are missing from the new sheet;
  - more than 10% of prices moved over 25%.
- **Ignored:** older files. **Listed as unmatched:** unrecognized names, such as manufacturer price lists; upload those by hand.
- A sheet from `/data` never replaces a newer live one: newest effective date wins.

One-time setup (the app reads Drive on its own with a service account):
1. In Google Cloud: create a project (or use one), enable the **Google Drive API**, then **IAM & Admin → Service accounts → Create**. Open it → **Keys → Add key → JSON** and download the key.
2. In Railway → Variables, add `GOOGLE_SERVICE_ACCOUNT_JSON` and paste the whole JSON file.
3. In Google Drive, share the price-sheet **Current** folder (and the job schedules, or the whole shared drive) with the service account's email (`…@….iam.gserviceaccount.com`) as **Viewer**.
4. That's it: the Current folder link is preset. Estimating → Price sheets shows the service account and a **Check now** button; Admin → Integrations shows it as connected.

Without a service account, an Admin can still connect their own Drive (Google OAuth client: `GOOGLE_CLIENT_ID/SECRET`, `APP_URL`, redirect `APP_URL/api/integrations/google_drive/callback`) and the sync runs as them.

## Plan & spec review (new construction)

Job → **Plan review**: reads a plan set or project manual into an estimator brief — scope by trade, products specified (with "or equal"), requirements (warranty, Class 4, wind), work by others, alternates, conflicts between sheets, and RFIs — every item with its page. Big sets are trimmed to the roof plans, elevations, sections and Division 07 (or the pages you name). Pitches and a roof-plan area go to the confirmation queue; RFIs become open items; matching templates are suggested.

## Billing (Phase 15)

Job → **Billing**: contract vs billed vs paid, deposit/progress/final invoices (retainage on commercial), a customer link with PDF and optional Stripe card payment, payments by check/ACH/card (card surcharge up to 3%, only if set), void with a reason, and change orders priced from an estimate and e-signed by the customer. **Reports → Receivables** is AR aging. Sent invoices and payments push to QuickBooks when it's connected.

## Tasks, dashboards, commissions (Phase 16)

Each job stage adds its next steps as tasks (follow up a bid, Form 17 before ordering, deposit invoice, order materials, schedule, final invoice, close costs). **My day** lists your tasks plus reminders: bids due, proposals unsigned after a week, crew insurance/licenses expiring, past-due invoices. **Reports → Sales & pipeline**, and **Reports → Commission calculator**: pick 10/60/40 or 8/50/50 (overhead % off the contract, then the profit splits company / rep) or custom rates, type the contract price and job cost or fill them from a sold job, and it shows each step. Nothing is saved.

## Customer portal and crew phone link (Phase 17)

- Job Overview → **Customer portal**: one private link with the job's stage, schedule, proposal, change orders, invoices and payments.
- Crews → crew → **Crew phone link**: the crew's own page with today's and the next two weeks' jobs, work orders, hours or piece-work logging (office approves), and delivery-ticket photos.
- Documents tab: link the job's **CompanyCam** project (photos show with `COMPANYCAM_TOKEN`) and record **EagleView** orders.

## Replacing AccuLynx (Phase 18)

BTRpro replaces AccuLynx for everything. The importers are for the one-time move:

1. Admin → **Import jobs (schedules)**: bring in the Residential and Commercial Live schedules (Drive or .xlsx). Each Builder-column name is matched to a builder/customer account.
2. Admin → **Import from AccuLynx (one-time)**: upload the AccuLynx jobs export. Columns and milestones are matched in a preview; jobs already here at the same address are linked, not duplicated; re-imports update by the old AccuLynx job number.
3. Work the setup checklist on that page.

## Receipts, crew portal and job photos (Phase 21)

- **Receipts in by email**: anyone on staff (or a crew login email) can email receipt photos/PDFs to `receipts@<INBOUND_EMAIL_DOMAIN>` (change the name with `RECEIPTS_INBOX`). The sender is recorded as the employee; the subject and message help find the job ("Whitfield roof – extra materials"). Mail from anyone else is ignored. Receipts are read in the background.
- **Review & approve** (Colin's JobReceipts design): each receipt shows what it read (employee, job, address, vendor, date), the job folder with a match % (PO/order # or old job # = 100%, street address 95–100%, job name alone at most 85% and always held for review), and internal pricing — the sales tax paid is spread across the lines as cost, then marked up (Company settings → Receipt markup %, 15% if blank; change it per receipt or per line) to get billed, profit and margin. Approve as **job cost only**, a **change order** (customer sees the materials table, net increase, previous contract price and new total, and signs online), or an **invoice** (sold jobs only). The real cost always files to the job. With QuickBooks connected, approval sends the change order as an Estimate or the invoice, plus the receipt as an Expense against the job's customer (set the QuickBooks item and expense / paid-from account ids in Company settings).
- **Readable photos**: every photo is auto-cropped to the paper (the white, unsaturated sheet — car seats, clipboards and warehouse backgrounds are cut away), turned upright, and contrast-cleaned. The AI gets the whole page plus zoomed, overlapping sections of tall pages so thermal-receipt print stays sharp. On the receipt page, tap a photo to zoom (cleaned or original, up to 500%, drag to pan), or use **Crop / rotate** to draw your own box, turn the photo, or go back to auto/whole photo — it reads the page again.
- **Formats it knows**: store receipts (Menards/Home Depot: SKU line under the description, "2 @62.99", TOTAL before tax = subtotal, PO # = job name, card lines ignored), ABC invoices, and ABC **delivery tickets** (ordered/shipped columns, no prices, handwritten add-ons flagged). A ticket's lines are priced from our sheets when the item # and unit match, or from a unit price the office types in; approving a ticket records the delivery (and attaches it to the material order when the PO matches) but files **no cost** — ABC's invoice brings the cost.
- **Job matching** treats a PO that spells out one job's name as a 95% match, and ignores BTR's own addresses (office, bill-to, shop) on ship-to lines.
- **Scan a receipt** (New → Scan a receipt, or Production → Supplier receipts): photograph an ABC receipt (several photos if it's long, or a PDF). The AI only transcribes what's printed; it never totals or fills gaps. BTRpro then:
  - finds the job from the PO / ABC order # (matched to the job's material orders), then the ship-to street address, then the job name. It only auto-picks a single clear match; otherwise it lists candidates and you pick.
  - checks each line's math (qty × price vs the printed amount) and the subtotal/total.
  - compares every item # with the active price sheets. On a builder's job it uses the builder's own price (and the builder's fallback setting for items they don't have); otherwise BTR standard. Units must match exactly — nothing is converted. Over-sheet lines are highlighted with the dollar difference.
  - **File to job costs** adds each line as a material cost with its sheet price, the tax as one line, and the photos to the job's documents. A PO matching a material order bills that order. The same invoice # can't be filed twice.
- **Crew portal** (`/crew`): an Admin turns on a crew's login on the crew's page (Crews & subs → crew → Crew portal login). A crew login can only:
  - upload job photos for jobs it's scheduled on or has a work order for — **Before**, **During the job**, **Finished work**, **Site cleanup**. Finished work and site cleanup are **required** before the crew can invoice that job.
  - send invoices (amount, invoice #, what it's for, PDF or photo).
  It can't open anything else in BTRpro, and turning the login off or changing the password signs the crew out.
- **Office review**: Production → **Crew invoices** (approve into job costs as labor for crews or subcontractor for subs, send back with a reason, mark paid) and **Crew photos to check**. On the job's **Photos** tab, mark each crew photo OK or flag a quality/cleanup issue; the crew sees flags in their portal. The dashboard counts crew invoices to review, crew photos to check, and receipts not filed.

## Interface (Phase 20)

- **Top bar**: Company updates, watch list, tasks due today, notifications bell, @Me mentions, and the account menu (Residential/Commercial view, Admin pages, sign out).
- **Toolbar**: New, Recent (jobs you opened), Dashboard, Contacts, Leads, Jobs (by milestone, mine, watch list), My day, Production, Reports, Estimating; job search on the right.
- **Milestones**: Lead (Lead) → Prospect (Estimating, Submitted) → Approved (Sold, Scheduled, In production) → Completed → Invoiced (Invoiced, Paid) → Closed. Advance Job moves to the next stage through the same gates as before; ••• moves anywhere or marks Lost.
- **Notifications panel**: activity and chat on jobs you sell, estimate or watch, @mentions, tasks due, and company updates. Admins post updates at /updates.
- **Photos**: each job links to its CompanyCam folder in Google Drive (auto-matched by street address, or picked by hand) and shows the photos by day. Share the BTR Contracting/CompanyCam folder with the service account.

Admins can delete jobs (Overview → Delete this job, or tick several on the Jobs list). Jobs with payments or QuickBooks invoices are kept.

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
| `POSTMARK_SERVER_TOKEN`, `EMAIL_FROM` | Sending proposals and notices by email |
| `APP_URL`, `GOOGLE_CLIENT_ID/SECRET`, `MS_CLIENT_ID/SECRET` | Mailbox connect (OAuth redirect is `APP_URL/api/mail/{google,microsoft}/callback`) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The app's own Google Drive access (price-sheet sync, schedule import, Drive document import). Raw JSON key or base64. Share the Drive folders with the service account's email. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Online card payments on invoices. Webhook URL: `APP_URL/api/stripe/webhook`, event `checkout.session.completed`. |
| `COMPANYCAM_TOKEN` | Shows CompanyCam photos on jobs |

## Tests

```bash
npm test          # Vitest; builds a fresh prisma/test.db from /data and seeds it
npm run lint      # TypeScript typecheck
npm run test:e2e  # Playwright: builds the app, runs it on a fresh prisma/e2e.db, and drives the browser
```

The end-to-end test creates a residential job, uploads a TEST_ONLY EagleView-style PDF, confirms the measurements in the queue, starts a Malarkey Vista AR estimate from its template and calculates it (checking acceptance test 4: 3 BX coil nails for 32.4 SQ), downloads the estimate PDF, records a material cost, and checks the job P&L. The AI read of the PDF is covered by unit tests with a fake client, so the browser run records the values that read would queue and a person confirms them. Locally, Chromium comes from `PLAYWRIGHT_BROWSERS_PATH` or `npx playwright install chromium`.

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

### After the first deploy

1. Sign in as the seed admin; add users (Admin → Users) and set company settings (markup, tax, deposit, invoice days, how to pay, card surcharge).
2. Google Drive: create a service account, put its key in `GOOGLE_SERVICE_ACCOUNT_JSON`, share the price-sheet folder and schedules with its email. The price-sheet folder is preset; sync runs on start and every 6 hours.
3. Email: `POSTMARK_SERVER_TOKEN` + `EMAIL_FROM` for invoices, proposals, change orders and orders; `INBOUND_EMAIL_*` for job forwarding addresses.
4. Optional: Stripe (webhook above), QuickBooks (`QBO_*`, redirect `APP_URL/api/integrations/quickbooks/callback`), CompanyCam token.
5. Import the schedules and the AccuLynx export once (Admin → Import from AccuLynx).

For larger teams, move to Postgres: change `provider` in `prisma/schema.prisma` to `postgresql`, set `DATABASE_URL`, and set `STORAGE_DRIVER=s3` for files.

## Data rules baked into the app

- Prices, item numbers, and UOMs come only from `data/`. Nothing in code or tests invents them.
- CALL items have no price and show **CALL — get quote**.
- The Hardie Statement (HS) sheet shows a **Confirm account** warning wherever it's used.
- LP SmartSide exists as a sheet record with no items, so LP items stay MISSING until a sheet is uploaded.
