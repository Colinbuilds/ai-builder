// Customer documents (change orders and invoices) and the internal job summary.
// A document is plain data; adapters render it (Google Docs in Apps Script, HTML in the demo).
// Customers see billed prices and vendors only. Cost, markup and profit stay internal.

/** Next change order number from existing change order names in the job folder. */
function nextChangeOrderNumber(existingNames) {
  var max = 0;
  (existingNames || []).forEach(function (name) {
    var m = String(name).match(/\b(?:co|change\s*order)\s*#?\s*(\d+)/i);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return max + 1;
}

/** File name for a document, using the job name exactly as it is in Drive. */
function documentName(kind, jobName, opts) {
  opts = opts || {};
  var job = String(jobName || "").trim();
  if (kind === "change_order") {
    var title = "Change Order #" + opts.number + " - " + job;
    return opts.summary ? title + " (" + opts.summary + ")" : title;
  }
  return "Invoice" + (opts.number ? " #" + opts.number : "") + " - " + job + (opts.date ? " - " + opts.date : "");
}

/**
 * Build a customer-facing document.
 * kind:   "change_order" | "invoice"
 * job:    { name } (Drive folder name)
 * priced: result of priceReceipt / combinePriced
 * info:   { number, date, description, reason, projectManager, contractPrice, company }
 */
function buildCustomerDocument(kind, job, priced, info) {
  info = info || {};
  var lines = priced.lines.map(function (l) {
    return {
      vendor: l.vendor,
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      amount: l.billed,
    };
  });
  var total = priced.totals.billed;
  var doc = {
    kind: kind,
    title: kind === "change_order" ? "Construction Change Order" : "Invoice",
    name: documentName(kind, job.name, { number: info.number, date: info.date, summary: info.summary }),
    projectName: job.name,
    location: info.location || job.address || job.name,
    date: info.date || "",
    number: info.number || "",
    projectManager: info.projectManager || "",
    description: info.description || "Additional materials as listed below.",
    reason: info.reason || "",
    lines: lines,
    total: total,
  };
  if (kind === "change_order" && info.contractPrice != null && info.contractPrice !== "") {
    doc.previousContractPrice = roundCents(info.contractPrice);
    doc.newContractPrice = roundCents(Number(info.contractPrice) + total);
  }
  return doc;
}

/** Internal summary for the office: cost, markup, billed and profit per line and in total. */
function buildInternalSummary(job, priced, receipts) {
  return {
    job: job.name,
    receipts: (receipts || []).map(function (r) {
      return { vendor: r.vendor, date: r.date, employee: r.employee, receiptNumber: r.receiptNumber, total: r.total };
    }),
    lines: priced.lines,
    totals: priced.totals,
  };
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Printable HTML for a customer document (demo preview and PDF export). */
function renderDocumentHtml(doc, company) {
  company = company || {};
  var rows = doc.lines.map(function (l) {
    var qty = l.qty && l.qty !== 1 ? l.qty + (l.unit ? " " + l.unit : "") : (l.unit ? "1 " + l.unit : "1");
    return "<tr><td>" + escapeHtml(l.vendor) + "</td><td>" + escapeHtml(l.description) + "</td><td class=n>" +
      escapeHtml(qty) + "</td><td class=n>" + formatMoney(l.amount) + "</td></tr>";
  }).join("");
  var head = doc.kind === "change_order"
    ? "<tr><th>Project name</th><td>" + escapeHtml(doc.projectName) + "</td><th>Change order #</th><td>" + escapeHtml(doc.number) + "</td></tr>" +
      "<tr><th>Location of work</th><td>" + escapeHtml(doc.location) + "</td><th>Date of request</th><td>" + escapeHtml(doc.date) + "</td></tr>" +
      "<tr><th>Project manager</th><td colspan=3>" + escapeHtml(doc.projectManager) + "</td></tr>"
    : "<tr><th>Bill to / Project</th><td>" + escapeHtml(doc.projectName) + "</td><th>Invoice #</th><td>" + escapeHtml(doc.number) + "</td></tr>" +
      "<tr><th>Location of work</th><td>" + escapeHtml(doc.location) + "</td><th>Date</th><td>" + escapeHtml(doc.date) + "</td></tr>";
  var change = doc.kind === "change_order"
    ? "<h3>Change request overview</h3><table class=kv><tr><th>Description of changes</th><td>" + escapeHtml(doc.description) +
      "</td></tr><tr><th>Reason for change</th><td>" + escapeHtml(doc.reason) + "</td></tr></table>"
    : "";
  var contract = doc.newContractPrice != null
    ? "<table class=kv><tr><th>Net increase</th><td class=n>" + formatMoney(doc.total) + "</td></tr><tr><th>Previous contract price</th><td class=n>" +
      formatMoney(doc.previousContractPrice) + "</td></tr><tr><th>Total contract price with approved changes</th><td class=n><b>" +
      formatMoney(doc.newContractPrice) + "</b></td></tr></table>"
    : "";
  var sign = doc.kind === "change_order"
    ? "<table class=sign><tr><td>Contractor signature &amp; date</td><td>Customer approval signature &amp; date</td></tr></table>"
    : "<p class=terms>Thank you for your business.</p>";
  return "<div class=doc><div class=dochead><div><b>" + escapeHtml(company.name || "") + "</b><br>" + escapeHtml(company.address || "") +
    "</div><h2>" + escapeHtml(doc.title) + "</h2></div><table class=kv>" + head + "</table>" + change +
    "<h3>Materials</h3><table class=items><thead><tr><th>Vendor</th><th>Item</th><th class=n>Qty</th><th class=n>Amount</th></tr></thead><tbody>" +
    rows + "</tbody><tfoot><tr><td colspan=3>Total</td><td class=n>" + formatMoney(doc.total) + "</td></tr></tfoot></table>" + contract + sign + "</div>";
}
