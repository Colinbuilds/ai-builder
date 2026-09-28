// API server for the AI Solo Business Toolkit (Cloudflare Worker).
//
// Customers sign in with Google in the web app. Every request carries their Google
// access token; the server checks it with Google, checks for an active Stripe
// subscription for that email, enforces the monthly run limit, then calls Claude.
//
// Secrets (wrangler secret put): ANTHROPIC_API_KEY, STRIPE_SECRET_KEY
// Vars (wrangler.toml): GOOGLE_CLIENT_ID, ALLOWED_ORIGIN, APP_URL, CLAUDE_MODEL, MONTHLY_RUN_LIMIT

import Anthropic from "@anthropic-ai/sdk";
import { buildBrief, getTool, outputSchema, publicTools } from "./tools.js";

// Models that accept server-side refusal fallbacks ("default" routing).
const FALLBACK_MODELS = new Set(["claude-opus-5", "claude-fable-5-1"]);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });
}

function corsHeaders(env, request) {
  const origin = request.headers.get("origin") || "";
  const allowed = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  const h = {
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
  if (allowed.includes(origin)) h["access-control-allow-origin"] = origin;
  return h;
}

// ---------------------------------------------------------------- Google identity

export async function verifyGoogleUser(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw new HttpError(401, "Please sign in.");
  const res = await fetch(
    "https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(token),
  );
  if (!res.ok) throw new HttpError(401, "Your session has expired. Please sign in again.");
  const info = await res.json();
  // The token must have been issued to this app, not some other Google app.
  if (info.aud !== env.GOOGLE_CLIENT_ID && info.azp !== env.GOOGLE_CLIENT_ID) {
    throw new HttpError(401, "Sign-in was not issued for this app.");
  }
  if (!info.email || String(info.email_verified) !== "true") {
    throw new HttpError(401, "Your Google account email is not verified.");
  }
  return info.email.toLowerCase();
}

// ---------------------------------------------------------------- Stripe

async function stripe(env, method, path, params) {
  const init = {
    method,
    headers: { authorization: "Bearer " + env.STRIPE_SECRET_KEY },
  };
  let url = "https://api.stripe.com/v1" + path;
  if (params) {
    const body = new URLSearchParams(params).toString();
    if (method === "GET") url += "?" + body;
    else {
      init.body = body;
      init.headers["content-type"] = "application/x-www-form-urlencoded";
    }
  }
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) {
    console.error("stripe error", path, res.status, data?.error?.message);
    throw new HttpError(502, "Could not check your subscription. Please try again in a minute.");
  }
  return data;
}

export function usageKey(now = new Date()) {
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `ai_runs_${now.getUTCFullYear()}_${m}`;
}

// Find the Stripe customer for this email that has a live subscription.
export async function findSubscriber(env, email) {
  const customers = await stripe(env, "GET", "/customers", { email, limit: "10" });
  for (const c of customers.data || []) {
    const subs = await stripe(env, "GET", "/subscriptions", { customer: c.id, status: "all", limit: "10" });
    if ((subs.data || []).some((s) => s.status === "active" || s.status === "trialing")) {
      return c;
    }
  }
  return { id: (customers.data || [])[0]?.id || null, subscribed: false };
}

async function account(env, email) {
  const customer = await findSubscriber(env, email);
  const subscribed = customer.subscribed !== false && !!customer.id;
  const used = subscribed ? Number(customer.metadata?.[usageKey()] || 0) : 0;
  return { customer, subscribed, used, limit: Number(env.MONTHLY_RUN_LIMIT || 100) };
}

// ---------------------------------------------------------------- Claude

export async function runTool(env, tool, brief, client) {
  client = client || new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const model = env.CLAUDE_MODEL || "claude-opus-5";
  const today = new Date().toISOString().slice(0, 10);
  const params = {
    model,
    max_tokens: 16000,
    system: tool.system,
    output_config: {
      effort: tool.effort,
      format: { type: "json_schema", schema: outputSchema(tool) },
    },
    messages: [{ role: "user", content: `Today is ${today}.\n\n${brief}` }],
  };
  if (FALLBACK_MODELS.has(model)) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }

  let response;
  try {
    response = await client.beta.messages.create(params);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      throw new HttpError(503, "The AI is busy right now. Please try again in a minute.");
    }
    if (err instanceof Anthropic.APIError) {
      console.error("anthropic error", err.status, err.message);
      throw new HttpError(502, "The AI service had a problem. Please try again.");
    }
    throw err;
  }

  if (response.stop_reason === "refusal") {
    throw new HttpError(422, "The AI couldn't help with that request. Please rephrase and try again.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new HttpError(422, "That was too much to do in one go. Try a smaller request (fewer days, emails or rows).");
  }
  const text = response.content.find((b) => b.type === "text")?.text;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(502, "The AI returned an unexpected answer. Please try again.");
  }
  const rows = (data.rows || []).map((r) => tool.columns.map((c) => String(r[c] ?? "")));
  return { title: String(data.title || tool.name).slice(0, 80), columns: tool.columns, rows };
}

// ---------------------------------------------------------------- Routes

export async function handle(request, env, deps = {}) {
  const url = new URL(request.url);
  const cors = corsHeaders(env, request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  try {
    if (url.pathname === "/api/tools" && request.method === "GET") {
      return json({ tools: publicTools() }, 200, cors);
    }

    if (url.pathname === "/api/me" && request.method === "GET") {
      const email = await verifyGoogleUser(request, env);
      const a = await account(env, email);
      return json({ email, subscribed: a.subscribed, used: a.used, limit: a.limit }, 200, cors);
    }

    if (url.pathname === "/api/run" && request.method === "POST") {
      const email = await verifyGoogleUser(request, env);
      const body = await request.json().catch(() => null);
      const tool = getTool(body?.toolId);
      if (!tool) throw new HttpError(400, "Unknown tool.");
      const { brief, error } = buildBrief(tool, body.inputs);
      if (error) throw new HttpError(400, error);

      const a = await account(env, email);
      if (!a.subscribed) throw new HttpError(402, "You need an active subscription to use the tools.");
      if (a.used >= a.limit) {
        throw new HttpError(429, `You've used all ${a.limit} AI runs for this month. They reset on the 1st.`);
      }

      const result = await runTool(env, tool, brief, deps.anthropic);
      const used = a.used + 1;
      await stripe(env, "POST", `/customers/${a.customer.id}`, { [`metadata[${usageKey()}]`]: String(used) });
      return json({ ...result, used, limit: a.limit }, 200, cors);
    }

    if (url.pathname === "/api/portal" && request.method === "POST") {
      const email = await verifyGoogleUser(request, env);
      const a = await account(env, email);
      if (!a.customer.id) throw new HttpError(404, "No subscription found for " + email + ".");
      const session = await stripe(env, "POST", "/billing_portal/sessions", {
        customer: a.customer.id,
        return_url: env.APP_URL,
      });
      return json({ url: session.url }, 200, cors);
    }

    return json({ error: "Not found" }, 404, cors);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status, cors);
    console.error("unhandled", err?.stack || err);
    return json({ error: "Something went wrong. Please try again." }, 500, cors);
  }
}

export default {
  fetch: (request, env) => handle(request, env),
};
