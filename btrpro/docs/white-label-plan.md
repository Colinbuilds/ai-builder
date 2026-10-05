# White-label plan

Goal: run BTRpro for contractors other than BTR Contracting without changing anything for BTR.

**Hard rule:** with no new settings filled in, BTR's deployment behaves exactly as it does today. Every new setting defaults to BTR's current value, and tests prove it.

## 1. Inventory of BTR-specific items

### Branding and copy
| Item | Where |
|---|---|
| `BTR` constant: name, address, phone, email, proposal letterhead, ABC account, own addresses | `src/lib/company.ts`, used in ~30 files (public pages `/p /c /co /i /w /quote /portal`, proposal/estimate/invoice/CO/pay-app PDFs, order emails, receipts, safety packet, not-found) |
| `SUPPLIER` constant (ABC Supply #112) | `src/lib/company.ts`, orders, sheets |
| "BTRpro" product name | ~59 files: layout title/metadata, top bar, login, emails, UA strings, page copy |
| "BTRbot" assistant name | ~42 files: AI errors in `src/lib/ai/claude.ts`, assistant UI, page copy |
| "BTR Contracting" literal | login, crew login, request form consent text, settings placeholder, bills email signature, AI task prompts (legacy proposal, codes, contract review), bid-watcher UA |
| Brand colors `--btr-*` | `src/app/globals.css` (light + dark), used as `btr-*` Tailwind tokens in ~80 files |
| Logo | `src/assets/btr-logo.png`, top bar, PDFs |
| Seed admin email `admin@btrcontracting.local` | `prisma/seed.ts` |

### AI estimating brain
| Item | Where |
|---|---|
| `CLAUDE.md` loaded verbatim as the system prompt for every AI call | `estimatorSystemPrompt()` / `system()` in `src/lib/ai/claude.ts` |
| BTR-specific sections: §1 company context, ABC reps, tools; §5 BTR price sheets + data flags; §6 locked BTR takeoff rules, waste defaults, Form 17; §2 "Omaha market" persona; §10 "Colin works with terse inputs" | `CLAUDE.md` |
| Generic sections (keep as product core): §3 accuracy rules, §4 intake, §7 workflow, §8 output structure, §9 change orders | `CLAUDE.md` |
| Structured company rules (ROOF-xx, PUB-01…) | `data/company_rules.json` → `Rule` table |
| Starter estimate templates, labor rates, crews, companies | `data/estimate_templates.json`, `data/btr_company_data.json` (seed) |

### Region rules
| Item | Where |
|---|---|
| Nebraska lien deadline, 120 days, Neb. Rev. Stat. § 52-137 | `src/lib/reports/risk.ts` (`LIEN_DAYS`), risk page copy, scorecard benchmark |
| Nebraska Form 17 (tax-exempt public jobs, rule PUB-01) | `projects/workflow.ts`, `projects/service.ts`, `orders/service.ts`, `estimates/rules.ts`, `tasks/service.ts`, `production/field.ts`, `desks.ts`, form17 panel, playbook SOP, jobs/schedule/orders copy |
| Omaha code adoptions (2018 IBC/IRC/IECC), code links, default jurisdiction "Omaha, NE" | `src/lib/codes/library.ts`, codes ask form + action |
| Public-bid sources (Omaha/Lincoln/Douglas/Lancaster/OPS/State of NE), home points + radius | `src/lib/bids/service.ts`, `src/lib/bids/parse.ts` (`HOMES`), bids page copy, `bidRadiusMiles` |
| Time zone `America/Chicago` / `todayInOmaha` | ~76 call sites, `src/lib/sheets/date-status.ts` |
| Address autocomplete bias to Omaha, state abbreviation list | `src/lib/integrations/address.ts` |
| Home market "Omaha" for builder matching | `src/lib/import/schedule.ts` |
| Sales tax | already a setting (`salesTaxPct`, null = MISSING); no hard-coded rate |

### Integrations with BTR defaults baked in
| Item | Where |
|---|---|
| BTR's Google Sheets (estimating schedule, residential/commercial production) | `estimating/schedule.ts`, `production/board.ts` defaults |
| BTR's jobs shared drive, CompanyCam Drive folder, price-sheet Drive folder | `import/drive-jobs.ts`, `integrations/drive-photos.ts`, `prisma/seed.ts` |
| ABC Supply account / bill-to, ABC API | `company.ts`, settings `abcBillTo`, `integrations` |
| AccuLynx import (retired, BTR legacy) | import code, job fields |
| Env-configured, already per-deployment: Anthropic, Google, QBO, Stripe, Postmark, EagleView, CompanyCam, Procore, MS, SAM, `EMAIL_FROM`, inbox addresses | env vars |

## 2. Architecture recommendation

**v1: one deployment per customer company** (own Railway service + own SQLite DB), configured by a company profile in settings plus env vars. BTR's deployment stays as is. True multi-tenant (one deployment, company id on every table, tenant-scoped auth and queries) is only worth it for self-serve SaaS signup; it touches every query in the app.

*Pending Colin's answer — see question below.*

## 3. Foundation build (v1)

1. **Company profile** (`src/lib/company-profile.ts`): stored in the existing `CompanySetting` key/value table, so no schema change. Fields: company name, product name (default "BTRpro"), assistant name (default "BTRbot"), logo (uploaded through existing storage), brand colors, address, phone, email, proposal letterhead, supplier block, state/region, time zone. `getCompany()` returns BTR's values for anything unset. Admin page under Settings.
2. **Swap hard-coded values**: server code and PDFs read `getCompany()`; layout injects brand color CSS variables and product name; `BTR` constant stays as the default source.
3. **AI rules**: split `CLAUDE.md` into the generic product core and the company layer. Company layer = editable "estimating rules" text in settings. Unset → BTR's current text, so BTR's prompt is byte-for-byte what it is today.
4. **Region rules as data** (`src/lib/region.ts`): per-state table of lien days + statute, public-purchasing tax-exempt form (NE: Form 17), code adoptions note, default jurisdiction, time zone. NE = BTR's. Unknown state → rules show as MISSING, never guessed.
5. **Tests**: default profile equals today's BTR constants; system prompt with no settings equals `CLAUDE.md`; NE region gives 120 days / Form 17; overrides flow through.

## 4. Later (not in this pass)
- Bid sources per region (currently NE boards only); time zone at all 76 call sites; seed packs per company (rules, templates, price sheets); retire BTR Drive/Sheet defaults for non-BTR deployments; rename `btr-*` tokens to `brand-*`.
