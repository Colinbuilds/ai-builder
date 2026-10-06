// Concept renderings: the customer's own photo with a new roof / siding / trim look, made by an image-editing
// model. Claude doesn't draw images, so this uses Google's Gemini image model (GEMINI_API_KEY) or OpenAI's
// image model (OPENAI_API_KEY), whichever key is set. Every rendering is labeled a concept, never a quote.
import sharp from "sharp";

export class RenderError extends Error {}

export type Provider = "gemini" | "openai";
export function renderProvider(): Provider | null {
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.OPENAI_API_KEY) return "openai";
  return null;
}

// ---------- the looks a customer can pick (plain color names, not product claims) ----------
export type Option = { key: string; label: string; hex: string; words: string };
export const ROOF_STYLES: Option[] = [
  { key: "shingle", label: "Architectural shingles", hex: "#55585c", words: "dimensional architectural asphalt shingles" },
  { key: "metal", label: "Standing-seam metal", hex: "#4b5157", words: "standing-seam metal roofing panels with vertical seams" },
];
export const ROOF_COLORS: Option[] = [
  { key: "charcoal", label: "Charcoal / black", hex: "#2f3133", words: "charcoal black" },
  { key: "slate", label: "Slate gray", hex: "#5d6670", words: "slate gray" },
  { key: "pewter", label: "Pewter gray", hex: "#7c8084", words: "medium pewter gray" },
  { key: "weathered", label: "Weathered wood", hex: "#6b6257", words: "weathered-wood brown-gray blend" },
  { key: "brown", label: "Dark brown", hex: "#4a3a2e", words: "dark chocolate brown" },
  { key: "driftwood", label: "Driftwood tan", hex: "#8b7d6b", words: "light driftwood tan-brown blend" },
  { key: "green", label: "Forest green", hex: "#34463a", words: "deep forest green" },
  { key: "red", label: "Barn red", hex: "#7a2e26", words: "barn red" },
];
export const SIDING_STYLES: Option[] = [
  { key: "lap", label: "Horizontal lap", hex: "#c9c9c9", words: "horizontal lap siding boards" },
  { key: "batten", label: "Vertical board & batten", hex: "#c9c9c9", words: "vertical board-and-batten siding" },
  { key: "shake", label: "Shake shingle look", hex: "#c9c9c9", words: "cedar-shake style shingle siding" },
];
export const SIDING_COLORS: Option[] = [
  { key: "white", label: "Bright white", hex: "#f2f2ee", words: "bright white" },
  { key: "lightgray", label: "Light gray", hex: "#c5c8c8", words: "light gray" },
  { key: "irongray", label: "Iron gray", hex: "#5c6064", words: "dark iron gray" },
  { key: "charcoal", label: "Charcoal", hex: "#36393c", words: "charcoal" },
  { key: "navy", label: "Navy blue", hex: "#2e3d55", words: "deep navy blue" },
  { key: "sage", label: "Sage green", hex: "#8f9c86", words: "muted sage green" },
  { key: "khaki", label: "Khaki tan", hex: "#b3a589", words: "khaki tan" },
  { key: "taupe", label: "Taupe", hex: "#8f8478", words: "warm taupe" },
  { key: "red", label: "Barn red", hex: "#7a2e26", words: "barn red" },
  { key: "black", label: "Black", hex: "#1f1f1f", words: "black" },
];
export const TRIM_COLORS: Option[] = [
  { key: "white", label: "White trim", hex: "#f7f7f5", words: "white" },
  { key: "black", label: "Black trim", hex: "#1f1f1f", words: "black" },
  { key: "match", label: "Match the siding", hex: "#999999", words: "" },
];

export type Choices = { roofStyle?: string | null; roofColor?: string | null; sidingStyle?: string | null; sidingColor?: string | null; trim?: string | null };
const pick = (list: Option[], k?: string | null) => (k ? list.find((o) => o.key === k) : undefined);

/** "Charcoal / black architectural shingles · Navy blue lap siding · White trim" */
export function lookLabel(c: Choices) {
  const parts: string[] = [];
  const rs = pick(ROOF_STYLES, c.roofStyle);
  const rc = pick(ROOF_COLORS, c.roofColor);
  if (rs || rc) parts.push(`${rc?.label ?? ""} ${rs?.label.toLowerCase() ?? "roof"}`.trim());
  const ss = pick(SIDING_STYLES, c.sidingStyle);
  const sc = pick(SIDING_COLORS, c.sidingColor);
  if (ss || sc) parts.push(`${sc?.label ?? ""} ${ss?.label.toLowerCase() ?? "siding"}`.trim());
  const t = pick(TRIM_COLORS, c.trim);
  if (t) parts.push(t.label);
  return parts.join(" · ");
}

/** The edit instruction. Masonry stays masonry (BTR never sides over brick or stone). */
export function renderPrompt(c: Choices) {
  const changes: string[] = [];
  const rs = pick(ROOF_STYLES, c.roofStyle);
  const rc = pick(ROOF_COLORS, c.roofColor);
  if (rs || rc) changes.push(`Replace the roof covering with ${rc?.words ?? "new"} ${rs?.words ?? "roofing"}. Keep the roof's shape, pitch, chimneys, vents and skylights where they are.`);
  const ss = pick(SIDING_STYLES, c.sidingStyle);
  const sc = pick(SIDING_COLORS, c.sidingColor);
  if (ss || sc) changes.push(`Replace the existing wall siding with ${sc?.words ?? "new"} ${ss?.words ?? "siding"}. Leave any brick, stone or stucco exactly as it is.`);
  const t = pick(TRIM_COLORS, c.trim);
  if (t && t.key !== "match") changes.push(`Make the trim, fascia, soffit and window/door casings ${t.words}.`);
  if (t?.key === "match" && sc) changes.push(`Make the trim, fascia and soffit the same color as the new siding.`);
  if (!changes.length) throw new RenderError("Pick a roof or siding look first.");
  return [
    "Edit this photograph of a building to show a remodeling concept.",
    ...changes,
    "Change nothing else: keep the exact camera angle, framing, building shape, windows, doors, garage doors, gutters, landscaping, vehicles, sky and lighting.",
    "The result must look like a real, unretouched photograph of the same building. Do not add text, labels, logos or watermarks. Do not add or remove any windows, doors or structures.",
  ].join("\n");
}

/** Photo → JPEG no larger than 1536 px (what the models work best with). */
async function prepare(photo: Uint8Array) {
  try {
    return await sharp(photo, { failOn: "none" }).rotate().resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  } catch {
    throw new RenderError("That photo couldn't be opened. Try a JPG or PNG.");
  }
}

async function gemini(jpeg: Buffer, prompt: string) {
  const model = process.env.RENDER_MODEL || "gemini-2.5-flash-image";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: jpeg.toString("base64") } }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new RenderError(`The rendering service answered ${res.status}. ${res.status === 400 || res.status === 403 ? "Check GEMINI_API_KEY and RENDER_MODEL." : "Try again in a minute."}`);
  type Part = { inlineData?: { data: string }; inline_data?: { data: string } };
  const j = (await res.json()) as { candidates?: { content?: { parts?: Part[] } }[] };
  const img = j.candidates?.[0]?.content?.parts?.map((p) => p.inlineData ?? p.inline_data).find((x) => x?.data);
  if (!img) throw new RenderError("The rendering didn't come back. Try a different photo or look.");
  return Buffer.from(img.data, "base64");
}

async function openai(jpeg: Buffer, prompt: string) {
  const form = new FormData();
  form.set("model", process.env.RENDER_MODEL || "gpt-image-1");
  form.set("prompt", prompt);
  form.set("size", "auto");
  form.set("quality", "medium");
  form.set("image", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "house.jpg");
  const res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form, signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new RenderError(`The rendering service answered ${res.status}. ${res.status === 401 || res.status === 400 ? "Check OPENAI_API_KEY and RENDER_MODEL." : "Try again in a minute."}`);
  const j = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw new RenderError("The rendering didn't come back. Try a different photo or look.");
  return Buffer.from(b64, "base64");
}

/** For tests: swap the image model for a fake. */
let fake: ((jpeg: Buffer, prompt: string) => Promise<Buffer>) | null = null;
export function setRendererForTests(f: typeof fake) {
  fake = f;
}

/** True when a rendering service (or the test fake) is available. */
export const renderReady = () => !!fake || !!renderProvider();

/** Renders the look on the photo; returns a JPEG. */
export async function renderLook(photo: Uint8Array, c: Choices) {
  const prompt = renderPrompt(c);
  const p = fake ? "fake" : renderProvider();
  if (!p) throw new RenderError("Renderings aren't turned on yet.");
  const jpeg = await prepare(photo);
  const out = fake ? await fake(jpeg, prompt) : p === "gemini" ? await gemini(jpeg, prompt) : await openai(jpeg, prompt);
  const final = await sharp(out).jpeg({ quality: 88 }).toBuffer().catch(() => out);
  return { image: final, prompt };
}
