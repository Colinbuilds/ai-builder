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

**Decision (Colin, 2026-10-05): one deployment per company.**

## 3. Built in this pass

- **Company profile** — `src/lib/company-profile.ts`, stored as `CompanySetting` `companyProfile` (no schema change). Settings → *Company profile & branding* (`/settings/profile`, Admin): names, short name, contact, letterhead, own addresses, supplier + account, state, home jurisdiction, lien-days override, accent and top-bar colors, logo (PNG/JPEG ≤ 2 MB, served at `/brand/logo`).
  - Fallback rule: while the company name is BTR's (or unset), every blank field is BTR's value. For any other company, BTR's contact facts, supplier and state never fill in: they're blank / MISSING. Product and assistant names default to BTRpro / BTRbot for everyone.
- **Hard-coded values swapped**: the `BTR` / `SUPPLIER` constants (public pages, PDFs, emails, orders, pay apps, safety packet, receipts, price-sheet account warning), "BTRpro", "BTRbot", "BTR Contracting" and most "BTR" copy now come from the profile. Server code uses `getCompany()` or the name helpers; client components use `useBrand()` (`src/components/brand.tsx`); pure modules shared with the browser use `src/lib/brand-names.ts`.
- **Brand colors**: `brandCss()` overrides the `--btr-*` CSS variables from the root layout. Nothing is injected for BTR.
- **AI rules** — `src/lib/ai/prompt.ts`. BTR with no saved rules: `CLAUDE.md` verbatim. Saved rules (`CompanySetting` `aiRules`) or another company: `prompts/estimator-core.md` (CLAUDE.md §3, 4, 7, 8, 9 with BTR wording removed) + a context block from the profile + the company's rules. The editor starts from BTR's own sections (§1, 2, 5, 6, 10). Saving them unchanged keeps CLAUDE.md.
- **Region rules as data** — `src/lib/region.ts`: lien days + statute, tax-exempt purchasing form, code-edition note. Nebraska is filled in. Any other state starts with nulls (lien deadline MISSING, generic form label), so nothing is guessed. Used by the risk desk, scorecard, Form 17 messages/banner/tasks, code library and the bid board (built-in Omaha/Lincoln boards only load for NE).
- **Tests** — `test/white-label.test.ts` proves BTR's defaults: same facts, names, CLAUDE.md byte-for-byte, Nebraska rules, unchanged messages, no injected CSS. It also covers a TEST_ONLY company end to end, including checking that no BTR text leaks into its prompt. The rest of the suite is unchanged and still passes.

## 4. Standing up a new company (v1)

1. New Railway service from this repo with its own volume (`/data`) and its own env (Anthropic key, Google, email, `APP_URL`, `SEED_ADMIN_*`). Never reuse BTR's credentials. Leave `SEED_COMPANY` unset (or `blank`): the new database gets only the admin user, with no BTR price sheets, rules, templates, labor rates, crews, companies or Drive folders (`src/lib/seed-mode.ts`).
2. Sign in as the seeded admin → Settings → Company profile: name, contact, state, colors, logo, estimating rules.
3. Upload that company's price sheets (Library → Price sheets); set its own Drive / sheet links (see "Later").

## 5. Later (not in this pass)
- **Seed data**: done (Colin, 2026-10-05): BTR's /data loads only for BTR. BTR's existing database keeps loading as before. **Rebuilding BTR from an empty database needs `SEED_COMPANY=btr`.**
- **BTR defaults in integrations**: estimating/production Google Sheets, jobs shared drive, CompanyCam folder (`DEFAULT_*` constants) should apply only to BTR.
- **Bids**: home points (`HOMES` in `bids/parse.ts`) are Omaha/Lincoln. Non-NE companies need their own centers and boards.
- **Time zone**: about 76 `America/Chicago` call sites. Add a profile time zone.
- **Remaining copy**: comments, BTR sheet names ("BTR - Steep Slope"), `btr-*` token names, a few module-level labels that pick up a rename only after a restart (bid source kinds, estimate status labels, crew-portal titles).
- **Address search bias** to Omaha (`integrations/address.ts`) and the AccuLynx importer (BTR-only).
- **More states** in `region.ts`, each checked against its statute.
