// Every AI call in the app goes through here. CLAUDE.md is the system prompt (BUILD_PROMPT §8),
// refusals are handled explicitly, and server-side fallback is on by default.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { readFileSync } from "node:fs";
import path from "node:path";

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class AiUnavailableError extends Error {
  constructor() {
    super("BTRbot isn't turned on yet. Set ANTHROPIC_API_KEY on the server.");
  }
}
export class AiRefusalError extends Error {
  constructor(public category: string | null) {
    super("BTRbot declined this request. Nothing was saved.");
  }
}

// Minimal surface we use, so tests can swap in a fake.
type AiClient = Pick<Anthropic, "beta">;
let override: AiClient | null = null;
export function setAiClientForTests(c: AiClient | null) {
  override = c;
}
let real: Anthropic | null = null;
export function aiClient(): AiClient {
  return client();
}
function client(): AiClient {
  if (override) return override;
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new AiUnavailableError();
  // API key only: a leftover ANTHROPIC_AUTH_TOKEN would otherwise go along as a bearer token and get the call rejected
  return (real ??= new Anthropic({ apiKey: key, authToken: null }));
}
export const aiConfigured = () => !!(override || process.env.ANTHROPIC_API_KEY?.trim());

let claudeMd: string | null = null;
/** The estimator knowledge base — loaded verbatim, never paraphrased. */
export function estimatorSystemPrompt() {
  return (claudeMd ??= readFileSync(path.join(process.cwd(), "CLAUDE.md"), "utf8"));
}

type Effort = "low" | "medium" | "high" | "xhigh" | "max";
type Msg = Anthropic.Beta.BetaMessageParam;

export const FALLBACK_BETAS = [FALLBACK_BETA];
export function system(task: string): Anthropic.Beta.BetaTextBlockParam[] {
  // Stable prefix first (cached), task-specific instructions after it.
  return [
    { type: "text", text: estimatorSystemPrompt(), cache_control: { type: "ephemeral" } },
    { type: "text", text: task },
  ];
}

function checkStop(res: { stop_reason: string | null; stop_details?: { category?: string | null } | null }) {
  if (res.stop_reason === "refusal") throw new AiRefusalError(res.stop_details?.category ?? null);
}

/** Plain-text answer. */
export async function aiText(opts: { task: string; messages: Msg[]; effort?: Effort; maxTokens?: number }) {
  const res = await client().beta.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system: system(opts.task),
    output_config: { effort: opts.effort ?? "medium" },
    messages: opts.messages,
  });
  checkStop(res);
  const text = res.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return { text, model: res.model };
}

/** Structured answer validated against a Zod schema. */
export async function aiParse<S extends z.ZodType>(opts: {
  task: string;
  messages: Msg[];
  schema: S;
  effort?: Effort;
  maxTokens?: number;
}): Promise<{ data: z.infer<S>; model: string }> {
  const res = await client().beta.messages.parse({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system: system(opts.task),
    output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
    messages: opts.messages,
  });
  checkStop(res);
  if (res.parsed_output == null) throw new Error("BTRbot's answer didn't come back in the expected format. Try again.");
  return { data: res.parsed_output as z.infer<S>, model: res.model };
}

export function aiErrorMessage(e: unknown): string {
  if (e instanceof AiUnavailableError || e instanceof AiRefusalError) return e.message;
  if (e instanceof Anthropic.RateLimitError) return "BTRbot is busy. Try again in a minute.";
  if (e instanceof Anthropic.AuthenticationError)
    return "BTRbot's key was rejected. In Railway, ANTHROPIC_API_KEY must be a key from console.anthropic.com → API Keys (starts sk-ant-api03-), and ANTHROPIC_AUTH_TOKEN should be deleted.";
  if (e instanceof Anthropic.APIError) {
    // Anthropic's own reason (no secrets in it) — e.g. low credit balance, image too large
    const reason = ((e.error as { error?: { message?: string } } | undefined)?.error?.message ?? "").slice(0, 300);
    if (/credit balance/i.test(reason))
      return "The Anthropic account is out of credit. console.anthropic.com → Settings → Billing → add credit (and turn on auto-reload), then try again.";
    if (e.status === 400 || e.status === 403 || e.status === 404) return `BTRbot request rejected (${e.status})${reason ? `: ${reason}` : ""}.`;
    return `BTRbot service error (${e.status ?? "network"}). Try again.`;
  }
  return e instanceof Error ? e.message : String(e);
}

export type WebSource = { url: string; title: string | null; cited: string | null };

/**
 * Research answer using live web search + fetch (server-side tools), with the pages it cited.
 * `allowedDomains` restricts both tools to those sites (e.g. official code / manufacturer domains).
 */
export async function aiResearch(opts: { task: string; question: string; context?: string; allowedDomains?: string[]; effort?: Effort; maxSearches?: number }) {
  const domains = opts.allowedDomains?.length ? { allowed_domains: opts.allowedDomains } : {};
  const messages: Msg[] = [
    {
      role: "user",
      content: [...(opts.context ? [{ type: "text" as const, text: opts.context }] : []), { type: "text" as const, text: opts.question }],
    },
  ];
  const content: Anthropic.Beta.BetaContentBlock[] = [];
  let model = MODEL;
  // a long research turn can pause; resume by sending the paused turn back (a few times at most)
  for (let round = 0; round < 4; round++) {
    const res = await client().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      system: system(opts.task),
      output_config: { effort: opts.effort ?? "high" },
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: opts.maxSearches ?? 6, ...domains },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6, ...domains },
      ],
      messages,
    });
    checkStop(res);
    model = res.model;
    content.push(...res.content);
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: res.content });
  }
  const text = content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  // the pages the answer actually cites (deduplicated by URL)
  const seen = new Map<string, WebSource>();
  for (const b of content) {
    if (b.type !== "text") continue;
    for (const c of b.citations ?? []) {
      const url = "url" in c ? (c.url as string) : null;
      if (!url || seen.has(url)) continue;
      seen.set(url, { url, title: "title" in c ? ((c.title as string | null) ?? null) : null, cited: "cited_text" in c ? ((c.cited_text as string | null) ?? null) : null });
    }
  }
  return { text, sources: [...seen.values()], model };
}
