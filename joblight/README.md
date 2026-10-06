# Joblight

The sales site and operator console for Joblight, the AI-run CRM for the trades.

- **Public site** (`/`, `/pricing`, `/demo`): what Joblight does, the per-user price calculator, and the demo request form.
- **Console** (`/console`, operator only): demo requests (leads) and every buildout. A buildout is one company's
  own Joblight, a separate Railway service with its own volume, database and logins.
  The console tracks each one's status, users, monthly rate, setup fee, address and health.

Pricing lives in `src/lib/pricing.ts` (first user $99, each added user 5% less, floor $40, custom over 20 users).
The site, calculator and console all read it.

## Run locally

```
cp .env.example .env   # fill in AUTH_SECRET, CONSOLE_EMAIL, CONSOLE_PASSWORD
npm install
npx prisma db push
npm run dev            # http://localhost:3000, console at /console
npm test
```

## Railway

Everything Joblight runs in its own Railway project, named "Joblight". No other company's services live there.

| Service | Root directory | Volume | Notes |
|---|---|---|---|
| **Joblight** (this app) | `joblight` | `/data` | Public site + console. Set `AUTH_SECRET`, `CONSOLE_EMAIL`, `CONSOLE_PASSWORD`. |
| **One per customer** | the CRM app (see below) | `/data` | Own variables: `AUTH_SECRET`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `APP_URL`, AI key… Leave `SEED_COMPANY` unset so it starts blank. |

Adding a customer:
1. In Railway, add a service for the CRM app, add a volume at `/data`, set its variables, and give it a domain.
2. In the console, **New buildout** (or **Start buildout** on their lead): company, trade, users, setup fee, public address,
   and the private address (`http://<service>.railway.internal:<port>`) so health checks stay on Railway's private network.
3. Sign in to their site as the seeded admin → Settings → Company profile: their name, logo, colors, state and Lumen's rules.
   Then add their people (Admin → Users).

Not built yet: a clean CRM app folder for customer services (the CRM currently ships from a folder that carries
another company's data and defaults, so customer services wait for that), creating Railway services from the
console (Railway API), customer billing (Stripe), and trade packs.
