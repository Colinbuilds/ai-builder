// AI receipt reading: builds the Claude request for a receipt photo/PDF plus the email
// it came with, and checks the answer. Sent over plain HTTPS (Apps Script has no SDK).
// API: https://docs.anthropic.com/en/api/messages

var CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
var CLAUDE_MODEL = "claude-opus-5";
var CLAUDE_FALLBACK_BETA = "server-side-fallback-2026-07-01";
var RECEIPT_IMAGE_TYPES = { "image/jpeg": 1, "image/png": 1, "image/gif": 1, "image/webp": 1 };

var RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    isReceipt: { type: "boolean", description: "False if the file is not a purchase receipt or invoice from a supplier" },
    employee: { type: "string", description: "Person who bought the materials; empty if unknown" },
    jobName: { type: "string", description: "Job, customer or project name as written; empty if none" },
    address: { type: "string", description: "Job site address as written; empty if none" },
    jobGuess: { type: "string", description: "Exact job folder name from the provided list that this receipt belongs to, or empty if unsure" },
    vendor: { type: "string", description: "Store or supplier name, e.g. ABC Supply Co." },
    date: { type: "string", description: "Purchase date as YYYY-MM-DD; empty if unreadable" },
    receiptNumber: { type: "string", description: "Receipt, invoice or order number; empty if none" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          qty: { type: "number" },
          unit: { type: "string", description: "Unit such as ea, bdl, sht, rl, box, ft; empty if none" },
          lineTotal: { type: "number", description: "Extended price for the line after any line discount, before tax" },
        },
        required: ["description", "qty", "unit", "lineTotal"],
        additionalProperties: false,
      },
    },
    subtotal: { type: "number" },
    tax: { type: "number" },
    total: { type: "number" },
    notes: { type: "string", description: "Anything unclear or unreadable the office should check; empty if none" },
  },
  required: ["isReceipt", "employee", "jobName", "address", "jobGuess", "vendor", "date", "receiptNumber", "items", "subtotal", "tax", "total", "notes"],
  additionalProperties: false,
};

var RECEIPT_INSTRUCTIONS = [
  "You read material receipts for a construction contractor.",
  "Extract the purchase from the attached receipt. Use the email details below for the employee and job when the receipt doesn't say.",
  "",
  "Rules:",
  "- items: one entry per product line, with the quantity, unit and extended price. Fold line discounts, core charges and deposits into the line they belong to. Do not include tax, payment, change or loyalty lines.",
  "- tax is the total sales tax charged. subtotal is before tax. total is the amount charged.",
  "- employee: the buyer's name from the receipt (customer, picked up by, signature, account contact) or else the email sender's name.",
  "- jobName and address: copy what the receipt or email says (PO/job field, delivery address, subject line). Do not invent them.",
  "- jobGuess: pick the exact matching folder name from the job list only if you are confident; otherwise leave it empty.",
  "- Never guess numbers. If something is unreadable, put your best reading and explain it in notes.",
].join("\n");

/**
 * Build the Messages API request.
 * file:    { mimeType, base64 }  image (jpeg/png/gif/webp) or application/pdf
 * context: { from, subject, body, receivedAt }
 * jobs:    array of job folder names
 * Returns { url, headers, body } or throws for unsupported files.
 */
function buildReceiptRequest(file, context, jobs, options) {
  options = options || {};
  var mime = String(file.mimeType || "").toLowerCase();
  var block;
  if (mime === "application/pdf") {
    block = { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.base64 } };
  } else if (RECEIPT_IMAGE_TYPES[mime]) {
    block = { type: "image", source: { type: "base64", media_type: mime, data: file.base64 } };
  } else {
    throw new Error("Unsupported file type " + (mime || "unknown") + ". Send a JPG, PNG or PDF (iPhone: set camera to Most Compatible).");
  }
  context = context || {};
  var email = [
    "Email/upload details:",
    "From: " + (context.from || ""),
    "Subject: " + (context.subject || ""),
    "Message: " + String(context.body || "").slice(0, 4000),
    "Received: " + (context.receivedAt || ""),
  ].join("\n");
  var jobList = "Job folders:\n" + (jobs || []).map(function (j) { return "- " + (typeof j === "string" ? j : j.name); }).join("\n");
  var model = options.model || CLAUDE_MODEL;
  var body = {
    model: model,
    max_tokens: 16000,
    output_config: { effort: options.effort || "medium", format: { type: "json_schema", schema: RECEIPT_SCHEMA } },
    messages: [{ role: "user", content: [block, { type: "text", text: RECEIPT_INSTRUCTIONS + "\n\n" + email + "\n\n" + jobList }] }],
  };
  var headers = { "x-api-key": options.apiKey || "", "anthropic-version": "2023-06-01", "content-type": "application/json" };
  // Server-side refusal fallback: supported on Claude Opus 5 / Fable 5.1.
  if (model === "claude-opus-5" || model === "claude-fable-5-1") {
    body.fallbacks = "default";
    headers["anthropic-beta"] = CLAUDE_FALLBACK_BETA;
  }
  return { url: CLAUDE_API_URL, headers: headers, body: body };
}

/** Parse the Messages API response into extracted receipt data. Throws with a readable message. */
function parseReceiptResponse(status, response) {
  if (status === 429 || status === 529) throw new Error("The AI service is busy. The receipt will be retried.");
  if (status >= 400) {
    var msg = response && response.error && response.error.message;
    throw new Error("AI request failed (" + status + ")" + (msg ? ": " + msg : ""));
  }
  if (response.stop_reason === "refusal") throw new Error("The AI declined to read this file. Please review it by hand.");
  if (response.stop_reason === "max_tokens") throw new Error("The receipt was too long to read in one pass. Please review it by hand.");
  var text = null;
  (response.content || []).forEach(function (b) { if (b.type === "text" && text === null) text = b.text; });
  if (!text) throw new Error("The AI returned no answer.");
  return normalizeExtraction(JSON.parse(text));
}

/** Clean numbers and flag anything that doesn't add up, so the office knows what to check. */
function normalizeExtraction(x) {
  var num = function (v) { var n = Number(v); return isFinite(n) ? roundCents(n) : 0; };
  var items = (x.items || []).map(function (it) {
    return { description: String(it.description || "").trim(), qty: Number(it.qty) || 1, unit: String(it.unit || "").trim(), lineTotal: num(it.lineTotal) };
  }).filter(function (it) { return it.description || it.lineTotal; });
  var out = {
    isReceipt: x.isReceipt !== false,
    employee: String(x.employee || "").trim(),
    jobName: String(x.jobName || "").trim(),
    address: String(x.address || "").trim(),
    jobGuess: String(x.jobGuess || "").trim(),
    vendor: String(x.vendor || "").trim(),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(x.date || "")) ? x.date : "",
    receiptNumber: String(x.receiptNumber || "").trim(),
    items: items,
    subtotal: num(x.subtotal),
    tax: num(x.tax),
    total: num(x.total),
    notes: String(x.notes || "").trim(),
  };
  var flags = [];
  if (!out.isReceipt) flags.push("This doesn't look like a receipt.");
  if (!out.items.length) flags.push("No line items found.");
  var itemsSum = roundCents(items.reduce(function (s, it) { return s + it.lineTotal; }, 0));
  if (out.subtotal && Math.abs(itemsSum - out.subtotal) > 0.05) {
    flags.push("Line items add up to " + formatMoney(itemsSum) + " but the subtotal is " + formatMoney(out.subtotal) + ".");
  }
  if (out.total && Math.abs(roundCents(out.subtotal + out.tax) - out.total) > 0.05) {
    flags.push("Subtotal plus tax (" + formatMoney(out.subtotal + out.tax) + ") doesn't equal the total " + formatMoney(out.total) + ".");
  }
  if (!out.vendor) flags.push("Vendor not found.");
  if (!out.employee) flags.push("Employee not found.");
  if (!out.date) flags.push("Date not readable.");
  if (out.notes) flags.push(out.notes);
  out.flags = flags;
  return out;
}

/**
 * Decide the job for an extracted receipt: address/name matching first, the AI's pick as backup.
 * Anything not confident goes to review.
 */
function resolveJob(extracted, context, jobs) {
  var hints = [extracted.jobName, extracted.address, context && context.subject, context && context.body].filter(Boolean);
  var m = matchJob(hints, jobs);
  var names = (jobs || []).map(function (j) { return typeof j === "string" ? j : j.name; });
  var guess = extracted.jobGuess && names.indexOf(extracted.jobGuess) >= 0 ? extracted.jobGuess : "";
  if (guess && m.job && m.job.name === guess && m.score >= 0.4) m.confident = true;
  if (guess && !m.confident && (!m.job || m.job.name !== guess)) m.aiSuggestion = guess;
  return m;
}
