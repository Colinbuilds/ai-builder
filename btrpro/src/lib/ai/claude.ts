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
    super("AI isn't configured. Set ANTHROPIC_API_KEY on the server to turn on AI features.");
  }
}
export class AiRefusalError extends Error {
  constructor(public category: string | null) {
    super("The AI declined this request. Nothing was saved.");
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
  if (res.parsed_output == null) throw new Error("The AI response didn't match the expected format.");
  return { data: res.parsed_output as z.infer<S>, model: res.model };
}

export function aiErrorMessage(e: unknown): string {
  if (e instanceof AiUnavailableError || e instanceof AiRefusalError) return e.message;
  if (e instanceof Anthropic.RateLimitError) return "The AI service is busy. Try again in a minute.";
  if (e instanceof Anthropic.AuthenticationError)
    return "The AI key was rejected. In Railway, ANTHROPIC_API_KEY must be a key from console.anthropic.com → API Keys (starts sk-ant-api03-), and ANTHROPIC_AUTH_TOKEN should be deleted.";
  if (e instanceof Anthropic.APIError) return `AI service error (${e.status ?? "network"}). Try again.`;
  return e instanceof Error ? e.message : String(e);
}
