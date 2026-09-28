import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { handle, usageKey } from "../src/index.js";
import { TOOLS, outputSchema, buildBrief } from "../src/tools.js";

const env = {
  GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com",
  ALLOWED_ORIGIN: "https://colinbuilds.github.io",
  APP_URL: "https://colinbuilds.github.io/ai-builder/app.html",
  CLAUDE_MODEL: "claude-opus-5",
  MONTHLY_RUN_LIMIT: "3",
  STRIPE_SECRET_KEY: "sk_test",
  ANTHROPIC_API_KEY: "key",
};

// Fake Google + Stripe backends.
let state;
beforeEach(() => {
  state = {
    token: { aud: env.GOOGLE_CLIENT_ID, email: "Buyer@Example.com", email_verified: "true" },
    customers: [{ id: "cus_1", metadata: {} }],
    subs: { cus_1: [{ status: "active" }] },
    updates: [],
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
    if (u.host === "oauth2.googleapis.com") {
      return u.searchParams.get("access_token") === "good" ? ok(state.token) : new Response("{}", { status: 400 });
    }
    if (u.pathname === "/v1/customers" && (init.method || "GET") === "GET") return ok({ data: state.customers });
    if (u.pathname === "/v1/subscriptions") return ok({ data: state.subs[u.searchParams.get("customer")] || [] });
    if (u.pathname.startsWith("/v1/customers/")) {
      state.updates.push(Object.fromEntries(new URLSearchParams(init.body)));
      return ok({});
    }
    if (u.pathname === "/v1/billing_portal/sessions") return ok({ url: "https://billing.stripe.com/x" });
    throw new Error("unexpected fetch " + url);
  };
});

function fakeClaude(response, capture = {}) {
  return { beta: { messages: { create: async (p) => { capture.params = p; if (response instanceof Error) throw response; return response; } } } };
}

const req = (path, { method = "GET", token = "good", body } = {}) =>
  new Request("https://api.test" + path, {
    method,
    headers: { authorization: token ? "Bearer " + token : "", origin: "https://colinbuilds.github.io", "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

const planInputs = {
  business: "Personal trainer", audience: "Busy parents", platforms: ["Instagram", "Bogus"],
  start_date: "2026-10-01", days: "7",
};

test("tools endpoint hides prompts", async () => {
  const res = await handle(req("/api/tools", { token: null }), env);
  const data = await res.json();
  assert.equal(data.tools.length, 4);
  assert.ok(!("system" in data.tools[0]));
  assert.equal(res.headers.get("access-control-allow-origin"), "https://colinbuilds.github.io");
});

test("me reports subscription and usage", async () => {
  state.customers[0].metadata[usageKey()] = "2";
  const data = await (await handle(req("/api/me"), env)).json();
  assert.deepEqual(data, { email: "buyer@example.com", subscribed: true, used: 2, limit: 3 });
});

test("bad token and wrong audience are rejected", async () => {
  assert.equal((await handle(req("/api/me", { token: "bad" }), env)).status, 401);
  state.token.aud = state.token.azp = "someone-else";
  assert.equal((await handle(req("/api/me"), env)).status, 401);
});

test("run: success counts usage and returns table", async () => {
  const cap = {};
  const claude = fakeClaude({
    stop_reason: "end_turn",
    content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify({
      title: "October plan", rows: [{ Date: "2026-10-01", Day: "Thursday", Platform: "Instagram", Pillar: "Story",
        Hook: "h", Caption: "c", "Call to action": "cta", Hashtags: "#fit" }] }) }],
  }, cap);
  const res = await handle(req("/api/run", { method: "POST", body: { toolId: "content-planner", inputs: planInputs } }), env, { anthropic: claude });
  const data = await res.json();
  assert.equal(res.status, 200, JSON.stringify(data));
  assert.equal(data.rows[0][2], "Instagram");
  assert.equal(data.used, 1);
  assert.deepEqual(state.updates, [{ [`metadata[${usageKey()}]`]: "1" }]);
  // request shape
  assert.equal(cap.params.model, "claude-opus-5");
  assert.equal(cap.params.fallbacks, "default");
  assert.deepEqual(cap.params.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(cap.params.output_config.format.type, "json_schema");
  assert.match(cap.params.messages[0].content, /Platforms\nInstagram\n/); // bogus option dropped
});

test("run: blocked without subscription, at limit, or with bad input", async () => {
  const claude = fakeClaude(new Error("should not be called"));
  const run = (inputs = planInputs) => handle(req("/api/run", { method: "POST", body: { toolId: "content-planner", inputs } }), env, { anthropic: claude });
  assert.equal((await run({ ...planInputs, days: "99" })).status, 400);
  assert.equal((await run({ ...planInputs, business: " " })).status, 400);
  state.customers[0].metadata[usageKey()] = "3";
  assert.equal((await run()).status, 429);
  state.subs.cus_1 = [{ status: "canceled" }];
  assert.equal((await run()).status, 402);
  state.customers = [];
  assert.equal((await run()).status, 402);
});

test("run: refusal and API errors map to friendly messages, no usage counted", async () => {
  const run = (claude) => handle(req("/api/run", { method: "POST", body: { toolId: "content-planner", inputs: planInputs } }), env, { anthropic: claude });
  assert.equal((await run(fakeClaude({ stop_reason: "refusal", content: [] }))).status, 422);
  assert.equal((await run(fakeClaude({ stop_reason: "max_tokens", content: [] }))).status, 422);
  const rl = new Anthropic.RateLimitError(429, { error: {} }, "rate", new Headers());
  assert.equal((await run(fakeClaude(rl))).status, 503);
  assert.equal(state.updates.length, 0);
});

test("portal returns stripe url", async () => {
  const data = await (await handle(req("/api/portal", { method: "POST" }), env)).json();
  assert.equal(data.url, "https://billing.stripe.com/x");
});

test("every tool schema is strict and briefs validate", () => {
  for (const t of TOOLS) {
    const s = outputSchema(t);
    assert.deepEqual(s.properties.rows.items.required, t.columns);
    assert.equal(s.properties.rows.items.additionalProperties, false);
    assert.ok(buildBrief(t, {}).error);
  }
});

test("site/tools.json is in sync with src/tools.js (run npm run export-tools)", async () => {
  const { readFileSync } = await import("node:fs");
  const { publicTools } = await import("../src/tools.js");
  const onDisk = JSON.parse(readFileSync(new URL("../../site/tools.json", import.meta.url)));
  assert.deepEqual(onDisk.tools, JSON.parse(JSON.stringify(publicTools())));
});
