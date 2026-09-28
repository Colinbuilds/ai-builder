# AI Business Toolkit

A subscription web app with four AI tools for solo business owners. Customers sign in with Google, fill in a short form, and the AI (Claude) produces a finished table that saves to their Google Drive as a formatted Google Sheet.

| Tool | Customer gives it | Customer gets |
|---|---|---|
| Content Planner | Business, audience, platforms, dates | Up to 31 days of posts: hook, caption, CTA, hashtags |
| Bookkeeping Assistant | Pasted bank transactions | Typed and categorized transactions, flagged for tax deductibility |
| Lead Follow-up Writer | Pasted leads and notes | Prioritized pipeline with a follow-up email draft per lead |
| Email Sequence Writer | Business, offer, sequence type | A complete email sequence with subjects and send days |

**Plan:** $29/month for 100 AI runs, billed by Stripe. Change `price`/`runsPerMonth` in `site/config.js` and `MONTHLY_RUN_LIMIT` in `worker/wrangler.toml`.

- Live site: https://colinbuilds.github.io/ai-builder/
- App: https://colinbuilds.github.io/ai-builder/app.html (shows **preview mode** with sample results until go-live setup is done)

## How it works

```
Browser (site/app.html)                     API server (worker/, Cloudflare)
  Sign in with Google ─── access token ───▶  checks token with Google
                                             checks Stripe for an active subscription
  "Generate with AI" ───────────────────▶   checks monthly run limit, calls Claude
                    ◀─── table ─────────     counts the run on the Stripe customer
  "Save to Google Drive"
  (browser → Google Sheets API directly, drive.file permission only)
```

- The AI key and Stripe key live only on the API server, never in the browser.
- Tool prompts live in `worker/src/tools.js`. After editing it, run `npm run export-tools` in `worker/` to refresh `site/tools.json`; a test fails if you forget.
- Customers must subscribe with the same email as their Google account. The app pre-fills it at checkout.

## Layout

```
site/        static website + app (GitHub Pages)
  index.html   sales page
  app.html     the app; app.js holds its logic
  config.js    ← go-live settings
  tools.json   tool forms (generated from worker/src/tools.js)
  samples.json sample results for preview mode
worker/      API server (Cloudflare Worker)
  src/index.js  routes: /api/me, /api/run, /api/portal
  src/tools.js  the 4 tools: forms, columns, AI instructions
  test/         unit tests (npm test)
research/    why this product: market data
product/     the original one-time download kit (PDF + spreadsheets); no longer sold on the site
```

## Go-live setup

Accounts and keys only the owner can create. Each step takes about 5 minutes.

1. **Anthropic (the AI).** At [console.anthropic.com](https://console.anthropic.com), add billing credits, then go to **API keys → Create key**. Save the key for step 5.
2. **Stripe (billing).** With the Stripe connector on claude.ai, Claude can create the product, the $29/month price and the payment link for you. To do it by hand:
   - Create a product "AI Business Toolkit" with a **recurring monthly** price.
   - Create a **Payment link** for it. Under *After payment*, redirect to `https://colinbuilds.github.io/ai-builder/app.html`.
   - Go to **Settings → Billing → Customer portal** and turn it on so customers can cancel.
   - Go to **Developers → API keys** and copy the **secret key** for step 5.
3. **Google sign-in.** At [console.cloud.google.com](https://console.cloud.google.com):
   - Create a project, then under **APIs & Services → Library** enable **Google Drive API** and **Google Sheets API**.
   - Set up the **OAuth consent screen**: External, with app name, support email, home page `https://colinbuilds.github.io/ai-builder/` and privacy policy `https://colinbuilds.github.io/ai-builder/privacy.html`. Add the scopes `email`, `profile` and `.../auth/drive.file`, then **Publish app**.
   - Go to **Credentials → Create credentials → OAuth client ID → Web application**, and add the authorized JavaScript origin `https://colinbuilds.github.io`. Copy the **Client ID**.
4. **Cloudflare (API server hosting, free tier).** Sign up at [dash.cloudflare.com](https://dash.cloudflare.com). Copy your **Account ID** from the Workers page. Then go to **My Profile → API Tokens → Create Token** and use the *Edit Cloudflare Workers* template.
5. **GitHub.** In the repo, go to **Settings → Secrets and variables → Actions**.
   - Under *Secrets*, add `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ANTHROPIC_API_KEY` and `STRIPE_SECRET_KEY`.
   - Under *Variables*, add `GOOGLE_CLIENT_ID`.
   - Under **Actions → Test and deploy API server → Run workflow**, run the deploy. The log shows the server URL, `https://ai-toolkit-api.<your-subdomain>.workers.dev`.
6. **Connect the site.** In `site/config.js`, set `apiBase` (the step 5 URL), `googleClientId`, `subscribeUrl` (the Stripe payment link) and `supportEmail`. Merge to `main`; the site redeploys automatically.

## AI cost per run

The server uses `claude-opus-5` (set by `CLAUDE_MODEL` in `worker/wrangler.toml`). A typical run costs roughly **$0.05–$0.30** in AI usage, depending on the tool and output size; a 30-day content plan sits at the top of that range. A customer who uses all 100 runs could cost up to about $25/month. To widen the margin, lower `MONTHLY_RUN_LIMIT`, raise the price, or switch `CLAUDE_MODEL` to `claude-sonnet-5`, which is about 60% cheaper per run.

## Development

```bash
cd worker && npm install && npm test         # API unit tests
npx wrangler deploy --dry-run --outdir .build # check the server bundles
cd ../site && python3 -m http.server 8765     # open http://localhost:8765/app.html (preview mode)
```
