# BUILD PROMPT — BTRpro app

> Put this whole folder (`CLAUDE.md`, `BUILD_PROMPT.md`, `data/`) in an empty project folder, open Claude Code there, and paste the prompt below.

---

## Prompt to paste into Claude Code

> **Scope note (Sept 29, 2026):** BTRpro is the system the whole company runs on, not only an estimating tool. It covers both residential and commercial work, from the first lead through estimating, selling, ordering, building, invoicing, and job costing. The estimating rules below apply to everything priced in it.

Build **BTRpro**, a production web app for BTR Contracting's roofing and exterior estimating team in Omaha, NE.

**Read these files first, in full, before writing any code:**
1. `CLAUDE.md` is the complete estimator knowledge base and behavior rules. It becomes the system prompt for every AI call in the app, and you must follow it while building.
2. `data/price_items.csv` / `data/price_items.json` hold 527 real BTR line items from 6 ABC Supply price sheets (item #, description, unit price, UOM, section, effective/expiration dates).
3. `data/price_sheets_meta.json` holds sheet metadata (account, rep, dates, scope, warnings).
4. `data/company_rules.json` holds BTR's locked takeoff rules for the rules engine.

These files are the source of truth. Do not invent prices, item numbers, coverage rates, labor rates, or production rates anywhere in code, seed data, or tests. Where the app needs a value the data doesn't contain, the UI asks the user and marks the value MISSING until it's provided.

---

### Tech stack
- Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui
- Postgres + Prisma (SQLite for local dev)
- Auth: email/password with roles (Admin, Estimator, Viewer)
- AI: Anthropic SDK (`@anthropic-ai/sdk`), model set in env as `ANTHROPIC_MODEL`, key in `ANTHROPIC_API_KEY`
- File storage: local `/uploads` in dev, S3-compatible in prod (env-configurable)
- PDF parsing: `pdf-parse` / `pdfjs-dist`, plus ZIP detection with `jszip` (see CLAUDE.md §5 — some BTR price sheets are ZIP containers)
- PDF generation: `@react-pdf/renderer`
- Tests: Vitest (unit) + Playwright (one end-to-end happy path)
- Deploy target: Vercel + Neon, or Railway. Include a README with setup, env vars, seed, and deploy steps.

---

### Data model (Prisma)

- **User** — id, name, email, role
- **PriceSheet** — code (MH/EL/SS/HP/HS/NX/…), name, sourceFile, account, salesRep, effectiveDate, expirationDate, scope, warning, uploadedAt, isActive
- **PriceItem**
  - Identity and pricing: sheetId, section, itemNumber, description, unitPrice (nullable), uom, priceStatus (LISTED | CALL)
  - Coverage: coverageQty (nullable), coverageUnit (nullable), coverageSource (PARSED_FROM_DESCRIPTION | USER_ENTERED | MANUFACTURER_DOC), tags[]
  - Unique on (sheetId, itemNumber)
- **Project**
  - Identity: name, address, client/GC, buildingUse, constructionType (NEW | REROOF), isPublic, isTaxExempt, form17Status (NOT_REQUIRED | PENDING | EXECUTED), bidDueDate, acculynxJobNumber, status (Lead | Estimating | Submitted | Won | Lost)
  - Readiness: readiness (NOT_READY | BUDGET | BID_READY)
- **IntakeField** — projectId, key (the intake fields in CLAUDE.md §4 — it lists 20, and CLAUDE.md is the source of truth), value, unit, status (VERIFIED | MISSING | ASSUMED | NOT_APPLICABLE), sourceDocId, sourcePage, approvedBy
- **Document** — projectId, type (EAGLEVIEW | PLANS | SPECS | MFR_DATA | SUB_PROPOSAL | CHANGE_ORDER | PHOTO | OTHER), fileUrl, pages, extractedText
- **Measurement**
  - projectId, key (see list below), value, unit, facet/elevation (optional)
  - Provenance: sourceDocId, sourcePage, status (EXTRACTED_PENDING | CONFIRMED | REJECTED | USER_ENTERED), confirmedBy
- **Estimate** — projectId, name/version (Rev 1, Rev 2…), scopeType (STEEP | LOW_SLOPE | DECK | SIDING | PANELS | MIXED), wastePctBySection (json), wasteApproved (bool), contingencyPct, notes, createdBy, locked
- **EstimateLine**
  - Placement: estimateId, section (MATERIAL_ROOFING | MATERIAL_DECK | MATERIAL_SIDING | GENERAL_CONDITIONS | LABOR)
  - Item and pricing: itemName, priceItemId (nullable), supplierItemNumber, quantity, unit, unitCost, total
  - Traceability: formula (string, human-readable), formulaInputs (json)
  - Status: sourceStatus (VERIFIED | SHEET_STALE | SHEET_EXPIRED | CALL_FOR_PRICE | MISSING_ITEM | MISSING_PRICE | PLACEHOLDER | ASSUMPTION_APPROVED | PENDING_AI), ruleId (nullable), sortOrder
- **LaborLine** — estimateId, task, crewSize, productionRate, productionUnit, laborHours, hourlyRate, burdenPct, total, sourceStatus
- **LaborStandard** (company library, starts EMPTY) — task, productionRate, unit, crewSize, hourlyRate, burdenPct, source, enteredBy
- **Rule** — seeded from `company_rules.json`; id, scope, text, formula, itemNumber, locked, active
- **OpenItem** — projectId/estimateId, text, owner, resolved
- **ScopeItem** — estimateId, type (WE_WILL | WE_WILL_NOT), text
- **BidResult** — projectId, ourBid, won, bidTabs (json: bidder, amount), notes
- **AuditLog** — who changed what, when (for price edits, rule edits, approvals)

**Measurement keys to support:**
- Roofing: roof_total_sf, roof_sq, pitch_by_facet, eaves_lf, rakes_lf, ridges_lf, hips_lf, valleys_lf, step_flashing_lf, wall_flashing_lf, drip_edge_lf, parapet_lf, perimeter_lf, penetrations_count, curbs_count, drains_count, skylights_count
- Walls: wall_total_sf, siding_sf, masonry_sf, openings_sf, window_count, door_count, outside_corners_lf, inside_corners_lf, masonry_corner_lf, soffit_sf, fascia_lf, building_height, wall_heights

---

### Features

#### 1. Price sheet library (Admin)
- **Seed** from `data/price_items.json` on first run.
- **Upload new sheets.** Parse text, handling the ZIP-container case: check for magic bytes `PK\x03\x04`, then unzip and read the `.txt` files. Parse row patterns: item number, a description that may wrap across lines, `$price` or `CALL`, and a UOM from the set {PC, PNL, SH, BX, BD, RL, SQ, EA, PK, KT, TB, DR, PA, CN, GA, BO, PT}. Parse the effective/expiration dates, account, and rep from the header.
- **Review screen before saving.** Show parsed rows in an editable grid, plus a diff against the previous version of the same sheet: new items, removed items, and price changes with the % change. Nothing goes live until the Admin confirms.
- **Date status**, computed daily against today:
  - EXPIRED: past the expiration date
  - EXPIRING: within 30 days of expiring
  - STALE: effective date more than 90 days ago
  - CURRENT: otherwise
  
  Show a banner on the dashboard for any sheet that isn't CURRENT, and put the status on every estimate line that uses that sheet.
- **Sheet warnings** from the metadata (for example, the Hardie Statement account mismatch) show wherever that sheet is used.
- **Coverage parsing** from descriptions — only explicit patterns, never guessed:
  - `3/SQ` → 3 bundles per SQ
  - `10SQ`, `2SQ`, `3.25SQ` → SQ per roll
  - `31LF`, `33.3LF`, `114.9LF`, `116'4" LF` → LF per bundle
  - `10'X100'` → 1,000 SF per roll
  - `4X8` / `4'X8'` → 32 SF per sheet
  - `4X4` → 16 SF
  - `1M` → 1,000 per box
  - `500`, `250`, `5C` → per box, where `5C` = 500
  
  Store the parsed value with source PARSED_FROM_DESCRIPTION and let the user override it. When nothing parses, coverage stays null and any calculation that needs it shows MISSING — ask the user.
- **Search:** global item search across all sheets (item #, description, section) with filters.
- **LP SmartSide placeholder:** create the sheet record as "not loaded". Any LP item shows MISSING until a sheet is uploaded.

#### 2. Projects and intake
- **Dashboard:** project list with status, bid due date, readiness badge, and sheet-status warnings.
- **New project wizard.** On creation, generate the missing-information checklist from the 20 intake fields in CLAUDE.md §4; each field is VERIFIED / MISSING / ASSUMED / N/A.
- **Public + tax-exempt jobs** get a persistent Form 17 banner until form17Status = EXECUTED.
- **Readiness** is computed, not set by hand:
  - BID_READY only when there are zero MISSING intake fields relevant to the scope, zero MISSING/PLACEHOLDER/PENDING_AI lines, all waste approved, labor complete, and no EXPIRED sheets.
  - BUDGET when approved assumptions exist but nothing is MISSING that would block a number.
  - NOT_READY otherwise.
- **"Why not bid ready?"** A panel lists every blocker with a link to fix it.

#### 3. Documents and measurement extraction
- **Upload:** drag-and-drop multi-file upload per project. Classify each document by type (user-confirmable).
- **EagleView extraction.** Send the text and page images to Claude with a strict JSON schema for the measurement keys above. Every extracted value needs a page reference. If Claude can't find a value, it returns null — never an estimate.
- **Plans/specs.** Claude extracts roof system, insulation R-value/thickness, warranty, edge metal, deck type, and spec sections (Div. 07 / 08), each with a page reference. **Roof area must come from the roof plan sheet (locked rule ROOF-01).** If the only area source is a floor-plan schedule, reject it with an explanation.
- **Confirmation queue.** Extracted values show beside a PDF viewer jumped to the source page. The user confirms, edits, or rejects each value; only CONFIRMED or USER_ENTERED values feed calculations.
- **Siding area (locked rule SID-01).** Use the EagleView "Siding" category only; masonry_sf and masonry_corner_lf are excluded from all siding math. Show this visibly on the siding takeoff.

#### 4. Takeoff and calculation engine (pure TypeScript, fully unit-tested)
- Implement as deterministic functions in `/lib/calc/`. The AI never does the arithmetic.
- **Core helpers:**
  - SF → SQ (÷100)
  - apply waste: qty × (1 + w)
  - round up to purchasable units with `ceil` — never round down
  - LF → pieces for a given piece length (12', 10', etc.)
  - rolls from area and roll coverage
  - boxes from counts and per-box quantity
- **Steep-slope module:**
  - shingles = ceil(roof_sq × (1+w) × bundles_per_sq)
  - starter on eaves + rakes (ROOF-05)
  - H&R at 25 LF/BD (ROOF-07)
  - ridge vent always included (ROOF-04)
  - underlayment
  - I&W by user-entered coverage rows (eaves width/courses, valleys)
  - drip edge, step flashing, pipe boots/penetrations
  - coil nails 1 BX/15 SQ (ROOF-02) and 1.25" cap nails 1 BX/15 SQ (ROOF-03)
- **Low-slope module (TPO/EPDM/mod bit):**
  - membrane rolls from field SF + flashing allowances the user enters
  - insulation boards per layer (SF ÷ board SF)
  - cover board, always included on EPDM (ROOF-08)
  - fasteners and plates from a user-entered fastening pattern (fasteners per board or per SF, by zone). Never assume a pattern; ask for the spec or manufacturer requirement.
  - pre-securement fasteners and plates are required on pre-secured EPDM (ROOF-09)
  - seam/splice tape, primer, adhesive by user-entered coverage
  - termination bar, walk pads, pipe boots, corners, curbs, drains, edge metal
- **Decking module:** deck SF → sheets/squares by user-entered deck profile coverage; side-lap fasteners, puddle welds, and screws from a user-entered pattern; closures and accessories.
- **Siding module:**
  - siding SF (SID-01/02) with 8.25" Hardie as the default (SID-03)
  - plank count from user-confirmed exposure and plank length
  - trim by LF → 12' pieces
  - corners, J-channel, starter, soffit, fascia
  - house wrap = cheapest wrap on the sheet in use (SID-04)
  - OSI Quad Max, touch-up kit, joint flashing, nails
- **Waste gate.** Residential roofing and siding default to 5% (pre-approved). Every other waste value shows the reference range and requires a click to approve. Unapproved waste blocks BID_READY.
- **Formulas.** Every line stores a human-readable formula string, e.g. `ceil(32.4 SQ × 1.05 × 3 BD/SQ) = 103 BD`, plus its inputs, shown on hover/expand.

#### 5. Estimate builder UI
- **Table:** `Item | Supplier Material # | Quantity | Unit | Unit Cost | Total | Source/Status`
- **Sections, in order:** Materials (Roofing / Deck / Siding) → General Conditions (dumpster, crane, lift, mobilization — user-priced) → Open Items → Labor → Scope.
- **Status colors:**
  - green: VERIFIED
  - amber: STALE, PLACEHOLDER, ASSUMPTION_APPROVED
  - red: MISSING, EXPIRED, CALL
  - blue: PENDING_AI
- **Item picker:** searches the price library filtered to the relevant sheet(s). Picking an item fills the item #, unit, and unit cost, and the line links to that sheet version.
- **No substitutions.** If a spec'd product isn't on a sheet, the line stays MISSING_ITEM. The user can pick an alternate only through an explicit "Substitute (requires approval)" action, which is logged and flagged on outputs.
- **Revisions:** Rev 1 / Rev 2 with a diff view of quantity, price, and total changes.
- **Totals:** material subtotal, general conditions, labor, contingency (user-set, recommended when assumptions exist), and grand total. MISSING lines are excluded from totals and the total is labeled INCOMPLETE.

#### 6. Labor
- **Labor lines:** task, crew size, production rate, production unit, labor hours = quantity ÷ production rate, hourly rate, burden %, and total.
- **Labor Standards library** starts empty. The estimator enters BTR's rates once and they're reused after that. A line with no standard shows MISSING, or PLACEHOLDER only if the user approves a placeholder value.

#### 7. Rules engine
- Load rules from the Rule table (seeded from `company_rules.json`) and evaluate them on every estimate recalculation.
- Show pass/fail next to the estimate, e.g. "ROOF-03 ✔ cap nails present — 3 BX" or "ROOF-09 ✖ pre-securement fasteners missing".
- Auto-add required lines (cap nails, coil nails, ridge vent, EPDM cover board) as suggestions the user accepts with one click.
- Locked rules can be edited by Admin only; every edit is written to the audit log.

#### 8. AI estimator assistant (per project side panel)
- **System prompt** = the full contents of `CLAUDE.md` + project intake + confirmed measurements + the current estimate + sheet date statuses.
- **Tool use** — give Claude tools rather than raw data dumps:
  - `search_price_items(query, sheet_codes?)`
  - `get_price_item(item_number)`
  - `get_measurements()`
  - `get_intake()`
  - `propose_line_items(lines[])`
  - `run_calc(module, inputs)`
  - `list_open_items()`
  - `add_open_item(text)`
  - `get_sheet_status()`
- **Rules for AI output:**
  - Claude may only cite prices and item numbers returned by the tools.
  - Proposed lines arrive as PENDING_AI and require accept/reject.
  - Server-side validation rejects any proposed line whose item number or price doesn't match the database.
- **Quick actions:**
  - "Start project" produces the missing-info checklist plus safe preliminary work.
  - "Review change order" and "Compare sub proposals" take uploaded documents and produce a structured table: inclusions, exclusions, unit pricing, specs, warranty, labor, risks and gaps.
  - "Write scope" produces the We Will / We Will Not list for the user to edit.
  - "What's missing?"
- **Behavior:** stream responses, ask one targeted question at a time, and keep a per-project chat history.

#### 9. Outputs
- **AccuLynx copy view:** plain Item / Quantity / Unit — no codes, no metadata — with a one-click copy of the whole list, formatted to paste cleanly.
- **Material order CSV:** Item # / Description / Qty / UOM / Sheet.
- **Estimate PDF (BTR format):**
  - BTR header (address, phone), project info, date, revision
  - materials table with item numbers and Source/Status
  - general conditions, open items, labor section, totals
  - We Will / We Will Not scope
  - readiness stamp (NOT READY FOR HARD BID / BUDGET / BID READY)
  - a price-sheet footnote with every sheet's effective/expiration dates and the 3% card surcharge note
- **Internal takeoff PDF:** every formula and source page reference, for QA.

#### 10. Calibration
- Per project: final bid amount, won/lost, and public bid tabs (bidder + amount).
- A report compares our $/SQ and $/SF against the winning bids for similar scope types.

#### 11. Job communication (internal chat + email + catch-up summaries)
Goal: one place per job for all internal talk, so the team stops running job details through long email chains, and anyone can get caught up at any point.
- **Job chat.** Every project has its own internal chat thread (all signed-in users; Viewers can read and post). Replies, @mentions of users, links to project documents, and edit history. Unread counts show on the dashboard project list. Updates arrive in near real time (SSE or short polling).
- **Job emails.** External email (GC, owner, supplier, subs) gets attached to the job three ways:
  - **Forwarding address:** each project has a unique inbound address (`job-<emailToken>@<inbound domain>`). An inbound-email webhook (Postmark / SendGrid / Mailgun, env-configurable) stores the message on the job.
  - **Mailbox pull (optional):** connect a Gmail / Microsoft 365 mailbox and pull threads that match a job label or search.
  - **Paste in:** manual fallback.
  - **Decision (Sept 29, 2026):** build both the forwarding address and the mailbox pull (Gmail and Microsoft 365).
  - De-duplicate on Message-ID. Keep the full text; store attachments as project Documents (type OTHER until classified).
- **Summaries.**
  - Each email gets a short AI summary (who, what they asked for, any dates or numbers they stated, attributed to the sender).
  - **"Catch me up"** on any job: Claude summarizes the chat, emails, open items, and current estimate status/readiness either since the user last looked or for the whole job. It states who said what and when, lists decisions made and questions still open, and keeps its output tied to the source messages.
  - Summaries follow CLAUDE.md: never invent prices, quantities, or dates. Numbers quoted from an email are labeled as stated by the sender, not as verified figures.
  - Summaries are saved (JobSummary) so the team sees the same catch-up, with the time range it covers.
- **AI assistant tool:** add `get_job_communications(since?)` so the estimator assistant can read the chat and email history for the job.

#### 12. Job costing and profit analysis
Goal: know what every job actually made, while it's running and after it closes, and where the money went.
- **Revenue per job:** the contract amount (from the accepted estimate or entered by hand), plus approved change orders and supplements, minus credits. Every figure keeps its source.
- **Estimated cost:** comes from the accepted estimate revision (materials, general conditions, labor) and is frozen when the job is sold, so it stays the baseline to compare against.
- **Actual cost**, logged against the job by category (materials, labor, subcontractors, equipment/rentals, dumpster/disposal, permits, other):
  - Material costs come from supplier invoices, delivery tickets, and returns/credits, by hand entry or CSV import of ABC invoices. Each line links to the order it came from once ordering exists (§13).
  - Labor comes from crew hours × rate × burden (the labor standards and rates from §6, or timesheets from §13), or from crew/sub pay entered per job.
  - Sub bills are entered against the sub's accepted proposal.
  - Every cost line has a date, vendor, reference #, who entered it, and an attachment (receipt or invoice photo).
- **Per-job P&L:**
  - Figures: contract, estimated cost, actual cost, gross profit, gross margin %, and estimated vs. actual variance by category.
  - Flag categories over estimate by more than a company-set threshold.
  - Show committed-but-not-yet-billed costs (open orders, accepted sub proposals) so margin is projected, not just to-date.
- **Overhead and commissions:**
  - Company overhead % and commission plans (on revenue or on gross profit, per salesperson) come from company settings the Admin enters.
  - The company settings start EMPTY. Until they are set, net profit and commission show MISSING. Never assume a rate.
- **Across jobs:**
  - Profit reports filtered by date range, job type (steep, low-slope, siding, panels), public vs. private, salesperson, estimator, and GC/client.
  - Reports show margin %, $/SQ and $/SF sold vs. cost, and estimate accuracy (actual ÷ estimated by category) so bids can be tuned.
  - Public bid tabs (§10) feed the same reports.
- **Permissions:** Viewers don't see cost or margin. Estimators see their own jobs. Admins see everything.
- **Close-out:** a job closes only when every bill is entered, or marked none-expected, and the final P&L is locked. After that, edits need an Admin and are audit-logged.

#### 13. Operations: replacing AccuLynx
Goal: BTR runs every job in this app instead of AccuLynx. The modules below are my understanding of AccuLynx's main tools. **Confirm which ones the team actually uses** and cut or add before each is built.
- **Customers and leads (CRM):** contacts and companies (homeowners, GCs, property managers, owners), lead source, and a sales pipeline with follow-up reminders. Duplicate detection on phone/email/address.
- **Job workflow:** Lead → Estimating → Submitted → Sold → Scheduled → In production → Complete → Invoiced → Paid → Closed. Required checklists per stage (e.g., Form 17 executed before materials on tax-exempt jobs, signed contract before scheduling), and an activity timeline per job.
- **Proposals and contracts:** the estimate becomes a customer-facing proposal (We Will / We Will Not scope, options, terms) with e-signature. An accepted proposal sets the contract amount and the job-costing baseline.
- **Material orders and deliveries:**
  - Build an order from the estimate's material lines (same item numbers) and send it to ABC Supply Branch #112 by email/PDF first, then by ABC's ordering API if BTR gets access.
  - Track delivery date, drop location, delivery tickets, backorders, and returns. Received quantities and invoices flow into job costing.
- **Production scheduling:** a calendar of installs, deliveries, inspections, and dumpster swaps; crew and sub assignment; weather notes; conflict warnings (the same crew double-booked).
- **Crews, subs, and work orders:**
  - Crew and subcontractor records (insurance/COI and license expiration dates are tracked with reminders).
  - Work orders are generated from the job scope and sent to the crew/sub.
  - Timesheets or piece-rate logging feed labor cost.
- **Invoicing and payments:**
  - Deposit, progress, and final invoices; retainage on commercial jobs.
  - Payment recording by check/ACH/card (card payments through a processor such as Stripe, showing the 3% card surcharge rule only where permitted).
  - AR aging, and a QuickBooks Online sync for invoices, payments, and job costs.
- **Change orders and supplements:** priced from the price library with the same rules as estimates, customer-approved by e-signature, then added to the contract amount and job costing.
- **Photos:** CompanyCam stays the photo tool. Link each job to its CompanyCam project and show its photos here (CompanyCam API).
- **Measurements:** order EagleView reports from the job and attach them automatically when ready (EagleView API, if BTR's account allows), feeding §3 extraction.
- **Tasks and reminders:** assigned tasks with due dates per job and a "my day" list; they are generated automatically by workflow stages.
- **Reports and dashboards:** pipeline value, close rate, sales by rep, production backlog, AR, and the §12 profit reports.
- **Customer portal:** homeowners/GCs see their proposal, schedule, invoices, and payments, and can sign and pay online.
- **Field mobile view:** the same app, laid out for phones. Crews see today's jobs, work orders, and addresses, and can clock hours and upload delivery tickets.
- **Migration off AccuLynx:** import existing contacts, open jobs, and history from AccuLynx exports (CSV). Keep the AccuLynx copy output (§9) until the cutover date.
- **Integrations that need BTR's accounts or approval** (ABC ordering API, EagleView, CompanyCam, QuickBooks, payment processor, e-signature): each is built behind a setting and works without the integration (manual entry/upload) until credentials are added.

#### 14. Integrations
Everything BTR already uses stays connected. Each integration is built behind a setting and has a manual fallback (upload, CSV, email), so the app works before any credentials are added. Admins see status and setup steps on **Settings → Integrations**.

| System | What it does in the app | Needs | Fallback until connected |
|---|---|---|---|
| **Google Drive** | Import plans, specs, EagleView PDFs, and photos into a job's Documents. Save proposals, estimate PDFs, and change orders to the job's Drive folder. | Google OAuth client (drive.file / drive.readonly) | Upload files directly |
| **QuickBooks Online** | Sync customers, invoices, payments, and vendor bills (job costing by customer/project). Pull actual costs into §12. | Intuit developer app + BTR company connect (OAuth 2.0) | CSV export/import |
| **EagleView** | Order roof/walls reports from the job, receive them when ready, and feed §3 extraction. | EagleView API credentials (account approval) | Upload the PDF/XML report |
| **ABC Supply (myABCsupply)** | Branch #112 pricing and item lookup, place material orders from the estimate, track order and delivery status, and import invoices for job costing. | ABC Supply API partner access for BTR's account | Email/PDF order; price-sheet upload (§1); invoice CSV import |
| **Change-order / project platforms** — Buildertrend (residential builders) and Procore (commercial GCs) | Link the job to the builder's/GC's project and pull change orders, RFIs, submittals, and schedule dates. Push BTR change orders and invoices where the platform allows. | Each platform's API app + the GC/builder granting BTR access to their project | Upload or forward the CO/RFI PDFs (job email address) |
| **Gmail / Microsoft 365** | Pull job email (§11). | Google/Microsoft OAuth client | Forwarding address, paste-in |
| **CompanyCam** | Show job photos (§13). | CompanyCam API token | Upload photos |

Rules for every integration:
- Credentials live in server environment variables or encrypted in the database, never in the browser.
- Imports are de-duplicated by the source system's ID.
- Everything pulled in is logged on the job timeline with its source.
- Numbers from outside systems keep their source label; they're never treated as verified BTR pricing unless they come from a loaded price sheet.

---

### Acceptance tests (must pass — use real data from `/data`)
1. The seed loads exactly 527 items across 6 sheets; 8 items have priceStatus CALL.
2. `getPriceItem("4292804534")` → 1.25" Plastic Cap Nails 2000/BX, $19.99, BX, sheet SS.
3. `getPriceItem("0150080011")` → 1.25" Coil Nail, $40.00, BX, sheet SS.
4. For a 32.4 SQ residential shingle job: waste 5% → 34.02 SQ; coil nails = ceil(34.02/15) = 3 BX; cap nails = 3 BX.
5. H&R for 95 LF hips + 40 LF ridge = ceil(135/25) = 6 BD, using the company 25 LF/BD rule — not the 31 LF listed on 04MLHR12AB.
6. Coverage parser: "Vista AR 252 3/SQ" → 3 BD/SQ; "GAF Tigerpaw 10SQ" → 10 SQ/RL; "MH 060 TPO 10'X100' White" → 1,000 SF/RL; "MH 2.0\" Poly Iso 1 4'X8'" → 32 SF/SH; "MH 3\" #14 HDP Fastener 1M" → 1,000/BX; "Elevt 6 Heavy Duty Fastener 5C" → 500/BX.
7. Siding takeoff with EagleView siding 2,400 SF, masonry 600 SF, openings 310 SF → siding area used = 2,400 SF (openings already excluded in the EagleView siding figure; masonry never added).
8. Date status as of 2026-09-29: all 6 sheets are STALE (MH/EL/SS/HP/HS effective 5/19/2026 = 133 days; NX effective 6/1/2026 = 120 days). None are EXPIRING yet (nearest expiration is 12/31/2026). As of 2026-12-05, MH/EL/SS/HS become EXPIRING.
9. A line referencing a non-existent item number → MISSING_ITEM, excluded from totals, estimate total labeled INCOMPLETE.
10. An AI-proposed line with a mismatched price is rejected server-side.
11. A public + tax-exempt project shows the Form 17 banner until it's marked EXECUTED.
12. BID_READY cannot be reached with any MISSING, PLACEHOLDER, or PENDING_AI line, unapproved waste, or an EXPIRED sheet.

---

### Build order — stop after each phase, run it, show me, and wait for my go-ahead
1. Scaffold, auth, Prisma schema, seed from `/data`, price library browse/search ✅
2. Price sheet upload/parse (including the ZIP case), review/diff, date status ✅
3. Customers/contacts + projects with the full job workflow stages, intake checklist, readiness engine, Form 17 logic ✅
4. Job communication: per-job chat, email capture (forwarding address + Gmail/M365 pull), per-email summaries, "Catch me up" ✅
5. Document upload + Claude extraction + confirmation queue, Google Drive import, EagleView upload/API, Integrations settings page ✅
6. Calc engine + unit tests (acceptance tests 2–9) ✅
7. Estimate builder UI, waste gate, substitutions, revisions ✅
8. Labor + labor standards library ✅
9. Rules engine ✅
10. AI assistant with tools + server-side validation
11. Outputs: AccuLynx copy, CSV, BTR PDF, internal takeoff PDF, customer proposal with e-signature
12. Job costing and profit analysis (§12), including actual-cost entry, ABC invoice CSV import, per-job P&L, and cross-job reports with calibration/bid tabs
13. Material orders and deliveries (§13), ABC Supply integration
14. Production scheduling, crews/subs, work orders, timesheets
15. Invoicing, payments, change orders/supplements, QuickBooks sync, Buildertrend/Procore change-order sync
16. Tasks/reminders, dashboards and reports, commissions
17. CompanyCam and EagleView links, customer portal, field mobile view
18. AccuLynx data migration and cutover
19. Playwright end-to-end: create project → upload a sample EagleView-style PDF → confirm measurements → build a shingle estimate → export PDF → record costs → see job P&L

**Ground rules:**
- Ask me one question at a time when something is unclear.
- Don't fabricate sample prices; test data must come from `/data` or be clearly labeled `TEST_ONLY`.
- Don't add features outside roofing, decking, siding, and envelope estimating, or BTR's job operations (§11–13).
