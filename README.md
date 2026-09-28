# ai-builder: The AI Solo Business Kit

A digital product and the website that sells it.

**Product:** 100 AI prompts, 3 business spreadsheets and a 7-day quick-start plan for freelancers and solopreneurs. It was chosen from market data; see [research/PRODUCT_RESEARCH.md](research/PRODUCT_RESEARCH.md).

| Tier | Price | Contents |
|---|---|---|
| Starter | $19 | Prompt library PDF |
| Complete | $49 | PDF + 7-day plan + Profit & Cash Flow Tracker, Content Calendar, Client CRM |
| Pro | $97 | Complete + Notion-ready Markdown + CSV + commercial licence |

## Layout

```
research/          why this product: data, scoring, pricing
product/
  content/         prompt library and playbook text (edit these to change the product)
  sheets.py        spreadsheet templates
  build.py         builds the PDFs, spreadsheets and one zip per tier into dist/
site/              static sales page (index.html, config.js, terms, privacy)
```

## Build the product

```bash
pip install -r requirements.txt
python3 product/build.py
# -> dist/ai-solo-business-kit-{starter,complete,pro}.zip
```

## Launch checklist

1. **Checkout.** Create 3 products on Gumroad, Lemon Squeezy, Payhip or Stripe Payment Links. Upload the matching zip from `dist/` as each product's file so delivery is automatic.
2. **Connect.** Paste the 3 checkout URLs and your support email into `site/config.js`.
3. **Legal.** Review `site/terms.html` and `site/privacy.html` for your jurisdiction.
4. **Publish the site.** Merge to `main` and enable GitHub Pages (Settings → Pages → Source: *GitHub Actions*). The workflow in `.github/workflows/pages.yml` deploys `site/`. Netlify, Vercel or Cloudflare Pages also work: point them at the `site/` folder with no build step.
5. **Optional.** Set `launchBanner` in `config.js` after you create the discount code in your checkout platform.
