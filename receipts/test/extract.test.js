const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
// Objects made inside the vm context have their own prototypes; compare as plain JSON.
const plain = (v) => JSON.parse(JSON.stringify(v));

const C = vm.createContext({ console });
for (const f of ["pricing.js", "match.js", "extract.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../core", f), "utf8"), C, { filename: f });
}
vm.runInContext(fs.readFileSync(path.join(__dirname, "../demo/samples.js"), "utf8"), C);

const ctx = { from: "Luis Ortega <luis@example.com>", subject: "Whitfield roof", body: "extra for back slope", receivedAt: "2026-09-29" };

test("request: image and PDF blocks, schema, fallback header, job list", () => {
  const r = C.buildReceiptRequest({ mimeType: "image/jpeg", base64: "AAAA" }, ctx, C.SAMPLE_JOBS, { apiKey: "k" });
  assert.equal(r.url, "https://api.anthropic.com/v1/messages");
  assert.equal(r.headers["x-api-key"], "k");
  assert.equal(r.headers["anthropic-version"], "2023-06-01");
  assert.equal(r.headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.equal(r.body.model, "claude-opus-5");
  assert.equal(r.body.fallbacks, "default");
  assert.equal(r.body.output_config.format.type, "json_schema");
  const [img, txt] = r.body.messages[0].content;
  assert.deepEqual(plain(img), { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } });
  assert.match(txt.text, /Subject: Whitfield roof/);
  assert.match(txt.text, /- Dana Whitfield - 4410 Maple Ridge Dr Omaha NE/);
  const pdf = C.buildReceiptRequest({ mimeType: "application/pdf", base64: "BB" }, ctx, [], {});
  assert.equal(pdf.body.messages[0].content[0].type, "document");
  const sonnet = C.buildReceiptRequest({ mimeType: "image/png", base64: "C" }, ctx, [], { model: "claude-sonnet-5" });
  assert.equal(sonnet.body.fallbacks, undefined);
  assert.equal(sonnet.headers["anthropic-beta"], undefined);
});

test("request: unsupported files explain what to send", () => {
  assert.throws(() => C.buildReceiptRequest({ mimeType: "image/heic", base64: "x" }, ctx, []), /JPG, PNG or PDF/);
});

test("schema: every property is required and strict", () => {
  const s = C.RECEIPT_SCHEMA;
  assert.deepEqual(plain([...s.required].sort()), Object.keys(s.properties).sort());
  assert.equal(s.additionalProperties, false);
  assert.equal(s.properties.items.items.additionalProperties, false);
});

const good = {
  isReceipt: true, employee: "Luis Ortega", jobName: "Whitfield", address: "4410 Maple Ridge Dr", jobGuess: "",
  vendor: "ABC Supply Co.", date: "2026-09-29", receiptNumber: "INV-1",
  items: [{ description: "Shingles", qty: 12, unit: "bdl", lineTotal: 510 }, { description: "OSB", qty: 14, unit: "sht", lineTotal: 238 }],
  subtotal: 748, tax: 52.36, total: 800.36, notes: "",
};
const reply = (obj, extra = {}) => ({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(obj) }], ...extra });

test("parse: clean receipt has no flags", () => {
  const x = C.parseReceiptResponse(200, reply(good));
  assert.equal(x.vendor, "ABC Supply Co.");
  assert.equal(x.items.length, 2);
  assert.deepEqual(plain(x.flags), []);
});

test("parse: math that doesn't add up and missing fields are flagged", () => {
  const x = C.parseReceiptResponse(200, reply({ ...good, subtotal: 760, total: 900, employee: "", date: "9/29" , notes: "Line 2 is smudged" }));
  assert.equal(x.date, "");
  assert.ok(x.flags.some((f) => /add up to \$748\.00 but the subtotal is \$760\.00/.test(f)));
  assert.ok(x.flags.some((f) => /doesn't equal the total \$900\.00/.test(f)));
  assert.ok(x.flags.includes("Employee not found."));
  assert.ok(x.flags.includes("Date not readable."));
  assert.ok(x.flags.includes("Line 2 is smudged"));
});

test("parse: a delivery ticket with no prices is flagged, and so is a single unpriced line", () => {
  const ticket = { ...good, items: good.items.map((i) => ({ ...i, lineTotal: 0 })), subtotal: 0, tax: 0, total: 0, notes: "" };
  const x = C.parseReceiptResponse(200, reply(ticket));
  assert.equal(x.items.length, 2);
  assert.ok(x.flags.some((f) => /^No prices on this receipt/.test(f)));
  const one = C.normalizeExtraction({ ...good, items: [good.items[0], { ...good.items[1], lineTotal: 0 }], subtotal: 510, total: 562.36 });
  assert.ok(one.flags.includes("No price on: OSB. Type in what it cost before approving."));
  assert.match(C.RECEIPT_INSTRUCTIONS, /Delivery tickets/);
});

test("parse: errors, refusals and truncation become readable messages", () => {
  assert.throws(() => C.parseReceiptResponse(429, {}), /busy/);
  assert.throws(() => C.parseReceiptResponse(400, { error: { message: "bad image" } }), /400\): bad image/);
  assert.throws(() => C.parseReceiptResponse(200, reply(good, { stop_reason: "refusal" })), /declined/);
  assert.throws(() => C.parseReceiptResponse(200, reply(good, { stop_reason: "max_tokens" })), /too long/);
  assert.throws(() => C.parseReceiptResponse(200, { stop_reason: "end_turn", content: [] }), /no answer/);
  assert.equal(C.parseReceiptResponse(200, reply({ ...good, isReceipt: false })).flags[0], "This doesn't look like a receipt.");
});

test("resolveJob: address match, AI pick as a tie-breaker, never auto-confident on AI alone", () => {
  const a = C.resolveJob({ jobName: "Whitfield", address: "4410 Maple Ridge Dr", jobGuess: "" }, {}, C.SAMPLE_JOBS);
  assert.ok(a.confident);
  assert.equal(a.job.name, "Dana Whitfield - 4410 Maple Ridge Dr Omaha NE");
  const b = C.resolveJob({ jobName: "Northgate", address: "", jobGuess: "Northgate Commons Office Building" }, {}, C.SAMPLE_JOBS);
  assert.ok(b.confident); // AI pick agrees with the top address/name match
  const c = C.resolveJob({ jobName: "the lake house", address: "", jobGuess: "Marcus Lee- 219 W Elm St" }, {}, C.SAMPLE_JOBS);
  assert.equal(c.confident, false);
  assert.equal(c.aiSuggestion, "Marcus Lee- 219 W Elm St");
  const d = C.resolveJob({ jobName: "x", address: "", jobGuess: "Not A Real Folder" }, {}, C.SAMPLE_JOBS);
  assert.equal(d.aiSuggestion, undefined);
});
