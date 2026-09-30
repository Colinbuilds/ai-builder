// ===== Start.gs =====
// JobReceipts: fill these in, then run setup (pick "setup" in the toolbar and click Run).
// Leave anything blank that you don't have yet; you can change them later in
// Project Settings → Script properties.
var FIRST_RUN_ = {
  ANTHROPIC_API_KEY: "",   // from console.anthropic.com → API keys (starts with sk-ant-)
  COMPANY_NAME: "",        // shown at the top of change orders and invoices
  COMPANY_ADDRESS: "",
};

// ===== Ai.gs =====
// Sends a receipt image or PDF to Claude and returns the checked, extracted data.

function readReceiptWithAi_(blob, context) {
  var apiKey = setting_("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("Add ANTHROPIC_API_KEY in Script properties to turn on receipt reading.");
  var jobs = listJobs_().map(function (j) { return j.name; });
  var req = buildReceiptRequest(
    { mimeType: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) },
    context, jobs, { apiKey: apiKey, model: setting_("CLAUDE_MODEL") }
  );
  var res = null;
  for (var attempt = 0; attempt < 3; attempt++) {
    res = UrlFetchApp.fetch(req.url, {
      method: "post", headers: req.headers, payload: JSON.stringify(req.body), muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    if (code !== 429 && code !== 529 && code < 500) break;
    Utilities.sleep(2000 * (attempt + 1)); // busy or server error: back off and retry
  }
  var body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) { body = {}; }
  return parseReceiptResponse(res.getResponseCode(), body);
}

// ===== Code.gs =====
// JobReceipts web app: entry point, receipt pipeline and the functions the page calls.
// Deployed as a web app that runs as the admin who deployed it. People open it with their own
// private link (?k=...); every function below checks who is calling.

function doGet(e) {
  var t = HtmlService.createTemplateFromFile("Index");
  t.key = String((e && e.parameter && e.parameter.k) || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return t.evaluate()
    .setTitle("JobReceipts")
    .addMetaTag("viewport", "width=device-width, initial-scale=1, viewport-fit=cover")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// ------------------------------------------------------------------ one-time setup

/** The page calls everything through here with the person's private link key. */
function api(key, name, args) {
  var API = { apiBootstrap: apiBootstrap, apiUpload: apiUpload, apiReceipts: apiReceipts, apiReceiptFile: apiReceiptFile, apiSaveDraft: apiSaveDraft,
    apiApprove: apiApprove, apiRetry: apiRetry, apiSettings: apiSettings, apiAddPerson: apiAddPerson, apiRemovePerson: apiRemovePerson };
  if (!Object.prototype.hasOwnProperty.call(API, name)) throw new Error("Unknown action.");
  CURRENT_PERSON_ = null;
  if (key) {
    CURRENT_PERSON_ = personByKey_(key);
    if (!CURRENT_PERSON_) throw new Error("This link doesn't work anymore. Ask the office for a new one.");
  }
  return API[name].apply(null, args || []);
}

/**
 * Run once from the editor (after the first Deploy): stores the settings filled in at the top of
 * the code, creates the records sheet, inbox and jobs folders, and makes the office link.
 */
function setup() {
  requireOwnerOrAdmin_();
  var props = PropertiesService.getScriptProperties();
  var first = typeof FIRST_RUN_ !== "undefined" ? FIRST_RUN_ : {};
  Object.keys(first).forEach(function (k) { if (first[k]) props.setProperty(k, String(first[k]).trim()); });
  if (!props.getProperty("JOBS_FOLDER_ID")) props.setProperty("JOBS_FOLDER_ID", DriveApp.createFolder("JobReceipts jobs").getId());
  if (!props.getProperty("DB_SPREADSHEET_ID")) {
    var ss = SpreadsheetApp.create("JobReceipts records (do not edit)");
    props.setProperty("DB_SPREADSHEET_ID", ss.getId());
  }
  receiptSheet_();
  if (!props.getProperty("INBOX_FOLDER_ID")) {
    props.setProperty("INBOX_FOLDER_ID", DriveApp.createFolder("JobReceipts inbox").getId());
  }
  var people = people_();
  var officeKey = Object.keys(people).filter(function (k) { return people[k].admin; })[0];
  if (!officeKey) { officeKey = newKey_(); people[officeKey] = { name: "Office", admin: true }; savePeople_(people); }
  var msg = "Setup complete. Your office link: " + personLink_(officeKey);
  Logger.log(msg);
  return msg;
}

function newKey_() {
  return Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "").slice(0, 8);
}

function personLink_(key) {
  var url = ScriptApp.getService().getUrl();
  return url ? url + "?k=" + key : "(deploy the web app first, then run setup again to see the link)";
}

function peopleList_() {
  var people = people_();
  return Object.keys(people).map(function (k) { return { name: people[k].name, admin: !!people[k].admin, link: personLink_(k) }; })
    .sort(function (a, b) { return (b.admin - a.admin) || a.name.localeCompare(b.name); });
}

/** Office: give someone their own link. admin=true lets them see everything. */
function apiAddPerson(name, admin) {
  requireAdmin_();
  name = String(name || "").trim().slice(0, 60);
  if (!name) throw new Error("Type the person's name.");
  var people = people_();
  if (Object.keys(people).some(function (k) { return people[k].name.toLowerCase() === name.toLowerCase(); })) throw new Error(name + " already has a link.");
  people[newKey_()] = { name: name, admin: !!admin };
  savePeople_(people);
  return peopleList_();
}

/** Office: turn off someone's link. Their receipts stay. */
function apiRemovePerson(name) {
  requireAdmin_();
  var people = people_();
  var keys = Object.keys(people).filter(function (k) { return people[k].name === name; });
  if (!keys.length) throw new Error("No one named " + name + ".");
  if (people[keys[0]].admin && Object.keys(people).filter(function (k) { return people[k].admin; }).length === 1) throw new Error("Keep at least one office link.");
  delete people[keys[0]];
  savePeople_(people);
  return peopleList_();
}

// ------------------------------------------------------------------ pipeline

function inboxFolder_() {
  return DriveApp.getFolderById(setting_("INBOX_FOLDER_ID"));
}

/**
 * Store the file, read it with AI, match the job and price it. Saves as it goes so a
 * failure leaves a visible record instead of a lost receipt.
 * chosenJobId: job the employee picked in the app.
 */
function processReceiptFile_(receipt, blob, context, chosenJobId) {
  var file = inboxFolder_().createFile(blob);
  receipt.fileId = file.getId();
  receipt.fileName = file.getName();
  saveReceipt_(receipt);

  var extracted = readReceiptWithAi_(blob, context);
  var jobs = listJobs_();
  var match;
  if (chosenJobId) {
    var picked = jobById_(chosenJobId);
    match = { job: picked, score: 1, confident: true, pickedBy: "employee", candidates: [] };
    var ai = resolveJob(extracted, context, jobs);
    if (ai.confident && ai.job && ai.job.id !== picked.id) {
      extracted.flags.push("The receipt mentions \"" + ai.job.name + "\" but the employee picked \"" + picked.name + "\".");
      match.confident = false;
      match.candidates = [{ job: picked, score: 1 }, { job: ai.job, score: ai.score }];
    }
  } else {
    match = resolveJob(extracted, context, jobs);
  }
  // A phone upload already tells us who bought it, even when the receipt doesn't.
  if (!extracted.employee && receipt.uploadedBy) {
    extracted.employee = receipt.uploadedBy;
    extracted.flags = extracted.flags.filter(function (f) { return f !== "Employee not found."; });
  }
  var priced = priceReceipt(extracted, { markupPercent: settingNumber_("DEFAULT_MARKUP_PERCENT"), includeTaxInCost: settingBool_("INCLUDE_TAX_IN_COST") });

  receipt.extracted = extracted;
  receipt.match = { confident: match.confident, score: match.score, aiSuggestion: match.aiSuggestion || "",
    candidates: (match.candidates || []).map(function (c) { return { id: c.job.id, name: c.job.name, score: c.score }; }) };
  var readName = String(extracted.jobName || extracted.address || "").trim();
  if (match.job && (match.confident || match.score >= 0.3)) { receipt.jobId = match.job.id; receipt.jobName = match.job.name; }
  else if (readName) {
    // A job that isn't in the Jobs folder yet: its folder is made when the office approves.
    receipt.jobId = "new:" + readName; receipt.jobName = readName;
    extracted.flags.push("New job \u201c" + readName + "\u201d from the receipt. Check the name; a folder is made for it when you approve.");
  }
  if (!receipt.employee) receipt.employee = extracted.employee;
  receipt.markupPercent = settingNumber_("DEFAULT_MARKUP_PERCENT");
  receipt.cost = priced.totals.cost;
  receipt.billed = priced.totals.billed;
  receipt.profit = priced.totals.profit;
  receipt.status = match.confident && !extracted.flags.length ? STATUS.READY : STATUS.REVIEW;
  receipt.error = "";
  saveReceipt_(receipt);
  return receipt;
}

// ------------------------------------------------------------------ page API

function apiBootstrap() {
  var email = requireUser_();
  var admin = isAdmin_(email);
  var receipts = visibleReceipts_(email);
  return {
    user: email,
    admin: admin,
    company: setting_("COMPANY_NAME"),
    companyAddress: setting_("COMPANY_ADDRESS"),
    defaultMarkup: settingNumber_("DEFAULT_MARKUP_PERCENT"),
    jobs: listJobs_(),
    receipts: admin ? receipts : receipts.map(employeeView_),
  };
}

/**
 * Employee upload from the phone.
 * input: { base64, mimeType, fileName } plus optional { jobId, note, suggestedAction }.
 * Without a jobId the job is read from the receipt (PO/job field or address).
 */
function apiUpload(input) {
  var email = requireUser_();
  if (!input || !input.base64) throw new Error("Take or choose a photo of the receipt first.");
  var job = input.jobId ? jobById_(input.jobId) : null;
  var blob = Utilities.newBlob(Utilities.base64Decode(input.base64), input.mimeType || "image/jpeg",
    (input.fileName || "receipt") .replace(/[\\/:*?"<>|]+/g, "-"));
  var name = email.split("@")[0];
  var receipt = {
    source: "upload", uploadedBy: email, employee: "", status: STATUS.READING, jobId: job ? job.id : "", jobName: job ? job.name : "",
    note: String(input.note || "").slice(0, 1000), suggestedAction: input.suggestedAction || "",
  };
  saveReceipt_(receipt);
  try {
    processReceiptFile_(receipt, blob, {
      from: name, subject: job ? "Receipt for " + job.name : "", body: receipt.note, receivedAt: new Date().toISOString(),
    }, job ? job.id : null);
  } catch (e) {
    receipt.status = STATUS.ERROR;
    receipt.error = String(e.message || e);
    saveReceipt_(receipt);
  }
  return isAdmin_(email) ? receipt : employeeView_(receipt);
}

function apiReceipts() {
  var email = requireUser_();
  var list = visibleReceipts_(email);
  return isAdmin_(email) ? list : list.map(employeeView_);
}

/** The receipt image/PDF as a data URL, for the admin review screen. */
function apiReceiptFile(id) {
  requireAdmin_();
  var r = getReceipt_(id);
  if (!r.fileId) return null;
  var blob = DriveApp.getFileById(r.fileId).getBlob();
  if (blob.getBytes().length > 8 * 1024 * 1024) return { url: DriveApp.getFileById(r.fileId).getUrl() };
  return { dataUrl: "data:" + blob.getContentType() + ";base64," + Utilities.base64Encode(blob.getBytes()), mimeType: blob.getContentType() };
}

/** Admin edits before approval: job, employee, line items, tax, markup. */
function apiSaveDraft(id, patch) {
  requireAdmin_();
  var r = getReceipt_(id);
  if (r.status === STATUS.APPROVED) throw new Error("This receipt is already approved.");
  if (patch.jobId) { var job = jobById_(patch.jobId); r.jobId = job.id; r.jobName = job.name; r.match = r.match || {}; r.match.confident = true; }
  if (patch.employee != null) r.employee = String(patch.employee);
  if (patch.extracted) r.extracted = normalizeExtraction(patch.extracted);
  if (patch.markupPercent != null) r.markupPercent = Number(patch.markupPercent);
  var priced = priceReceipt(r.extracted, { markupPercent: r.markupPercent, includeTaxInCost: settingBool_("INCLUDE_TAX_IN_COST") });
  r.cost = priced.totals.cost; r.billed = priced.totals.billed; r.profit = priced.totals.profit;
  if (r.status !== STATUS.ERROR) r.status = r.jobId && r.cost > 0 ? STATUS.READY : STATUS.REVIEW;
  return saveReceipt_(r);
}

/**
 * Approve: create the change order or invoice, send to QuickBooks, file the receipt.
 * opts: { action: "change_order"|"invoice", markupPercent, description, reason, contractPrice, projectManager, date }
 */
function apiApprove(id, opts) {
  var admin = requireAdmin_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var r = getReceipt_(id);
    if (r.status === STATUS.APPROVED) throw new Error("This receipt is already approved.");
    if (!r.jobId) throw new Error("Pick the job first.");
    if (opts.action !== "change_order" && opts.action !== "invoice") throw new Error("Choose change order or invoice.");
    var job = jobById_(r.jobId);
    r.jobId = job.id; r.jobName = job.name;
    var jobFolder = DriveApp.getFolderById(job.id);
    var markup = opts.markupPercent != null ? Number(opts.markupPercent) : r.markupPercent;
    var priced = priceReceipt(r.extracted, { markupPercent: markup, includeTaxInCost: settingBool_("INCLUDE_TAX_IN_COST") });
    if (!(priced.totals.cost > 0)) throw new Error("This receipt has no prices yet. Type in what each line cost, then approve.");
    var date = opts.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

    var number = "";
    if (opts.action === "change_order") {
      number = nextChangeOrderNumber(existingChangeOrderNames_(ensureFolderPath_(jobFolder, setting_("CHANGE_ORDERS_PATH"))));
    }
    var qbo = null;
    if (qboReady_()) {
      qbo = sendToQuickBooks_(opts.action, job, priced, r, { date: date, number: number });
      if (opts.action === "invoice") number = qbo.salesNumber;
    }
    var doc = buildCustomerDocument(opts.action, job, priced, {
      number: number, date: date, projectManager: opts.projectManager || "",
      description: opts.description, reason: opts.reason, contractPrice: opts.contractPrice, summary: opts.summary,
    });
    var created = createCustomerDoc_(jobFolder, doc);

    if (r.fileId) {
      var file = DriveApp.getFileById(r.fileId);
      file.moveTo(ensureFolderPath_(jobFolder, setting_("RECEIPTS_SUBFOLDER")));
    }
    r.status = STATUS.APPROVED;
    r.action = opts.action;
    r.markupPercent = markup;
    r.cost = priced.totals.cost; r.billed = priced.totals.billed; r.profit = priced.totals.profit;
    r.docId = created.docId; r.docName = created.name;
    r.qbo = qbo || { skipped: "QuickBooks not connected" };
    r.approvedBy = admin; r.approvedAt = new Date().toISOString();
    r.error = "";
    saveReceipt_(r);
    return { receipt: r, docUrl: created.url, pdfId: created.pdfId };
  } finally {
    lock.releaseLock();
  }
}

/** Retry reading a receipt that failed (e.g. the AI was busy). */
function apiRetry(id) {
  requireAdmin_();
  var r = getReceipt_(id);
  if (!r.fileId) throw new Error("There's no file on this receipt to read.");
  var blob = DriveApp.getFileById(r.fileId).getBlob();
  r.status = STATUS.READING; r.error = ""; saveReceipt_(r);
  try {
    var extracted = readReceiptWithAi_(blob, { from: r.employee || r.uploadedBy, subject: r.jobName ? "Receipt for " + r.jobName : "", body: r.note || "" });
    r.extracted = extracted;
    var priced = priceReceipt(extracted, { markupPercent: r.markupPercent || settingNumber_("DEFAULT_MARKUP_PERCENT"), includeTaxInCost: settingBool_("INCLUDE_TAX_IN_COST") });
    r.cost = priced.totals.cost; r.billed = priced.totals.billed; r.profit = priced.totals.profit;
    if (!r.employee) r.employee = extracted.employee;
    r.status = r.jobId && !extracted.flags.length ? STATUS.READY : STATUS.REVIEW;
  } catch (e) {
    r.status = STATUS.ERROR; r.error = String(e.message || e);
  }
  return saveReceipt_(r);
}

function apiSettings() {
  requireAdmin_();
  return {
    quickbooks: qboStatus_(),
    ai: !!setting_("ANTHROPIC_API_KEY"),
    admins: adminEmails_(),
    defaultMarkup: settingNumber_("DEFAULT_MARKUP_PERCENT"),
    changeOrderTemplate: !!setting_("CHANGE_ORDER_TEMPLATE_ID"),
    people: peopleList_(),
  };
}

// ===== Config.gs =====
// Settings live in Script Properties (Project Settings → Script properties).
// Secrets (API keys) are never sent to the browser.

var SETTING_DEFAULTS = {
  COMPANY_NAME: "",
  COMPANY_ADDRESS: "",
  ADMIN_EMAILS: "",                // comma-separated; these people see everything
  JOBS_FOLDER_ID: "",              // folder (or shared drive) that holds one folder per job
  CHANGE_ORDER_TEMPLATE_ID: "",    // Google Doc change order template (optional)
  RECEIPTS_SUBFOLDER: "Receipts",
  CHANGE_ORDERS_PATH: "Project Management/Change Orders",
  INVOICES_SUBFOLDER: "Invoices",
  DEFAULT_MARKUP_PERCENT: "28",
  INCLUDE_TAX_IN_COST: "true",
  DB_SPREADSHEET_ID: "",           // created by setup()
  ANTHROPIC_API_KEY: "",
  CLAUDE_MODEL: "claude-opus-5",
  QBO_CLIENT_ID: "",
  QBO_CLIENT_SECRET: "",
  QBO_ENVIRONMENT: "production",   // or "sandbox"
  QBO_MATERIALS_ITEM: "Materials", // Products & Services item used on invoice lines
  QBO_EXPENSE_ACCOUNT: "Job Materials",
  QBO_PAYMENT_ACCOUNT: "",         // bank or credit card account the store purchases are paid from
  QBO_PAYMENT_TYPE: "CreditCard",  // CreditCard, Cash or Check
  QBO_RECORD_EXPENSES: "true",
  INBOX_FOLDER_ID: "",             // created by setup(): receipts wait here until a job is confirmed
};

var SECRET_SETTINGS = { ANTHROPIC_API_KEY: 1, QBO_CLIENT_SECRET: 1 };

function setting_(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return v == null || v === "" ? SETTING_DEFAULTS[key] : v;
}

function settingNumber_(key) {
  var n = Number(setting_(key));
  return isFinite(n) ? n : Number(SETTING_DEFAULTS[key]);
}

function settingBool_(key) {
  return String(setting_(key)).toLowerCase() === "true";
}

// People open the app with a private link (?k=...). Set per call by api().
var CURRENT_PERSON_ = null;

function currentUserEmail_() {
  if (CURRENT_PERSON_) return CURRENT_PERSON_.name;
  return String(Session.getActiveUser().getEmail() || "").toLowerCase();
}

/** People with a private link: { key: { name, admin } } in Script Properties. */
function people_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty("PEOPLE") || "{}"); } catch (e) { return {}; }
}

function savePeople_(people) {
  PropertiesService.getScriptProperties().setProperty("PEOPLE", JSON.stringify(people));
}

function personByKey_(key) {
  var p = key ? people_()[key] : null;
  return p ? { name: p.name, admin: !!p.admin } : null;
}

function adminEmails_() {
  return String(setting_("ADMIN_EMAILS")).toLowerCase().split(",").map(function (s) { return s.trim(); }).filter(String);
}

function isAdmin_(email) {
  if (CURRENT_PERSON_) return CURRENT_PERSON_.admin;
  email = (email || currentUserEmail_()).toLowerCase();
  var admins = adminEmails_();
  // Until admins are configured, only the person who deployed the app is admin.
  if (!admins.length) return email === String(Session.getEffectiveUser().getEmail()).toLowerCase();
  return admins.indexOf(email) >= 0;
}

function requireUser_() {
  var email = currentUserEmail_();
  if (!email) throw new Error("Open JobReceipts with the link the office sent you.");
  return email;
}

function requireAdmin_() {
  var email = requireUser_();
  if (!isAdmin_(email)) throw new Error("Only admins can do that.");
  return email;
}

/** For functions that also run from the editor: allow the owner and admins. */
function requireOwnerOrAdmin_() {
  var email = currentUserEmail_();
  if (!email) return;
  if (email === String(Session.getEffectiveUser().getEmail()).toLowerCase() || isAdmin_(email)) return;
  throw new Error("Only admins can do that.");
}

// ===== Docs.gs =====
// Creates the customer's change order or invoice as a Google Doc (and PDF) in the job folder.
// Change orders use CHANGE_ORDER_TEMPLATE_ID when set: labels in its tables ("PROJECT NAME",
// "LOCATION OF WORK", ...) get the value written into the cell next to them, and a
// materials table (vendor on every line) is inserted above the signature section.
// Signature-block cells (NAME & TITLE, DATE) are deliberately left for people to sign.

var TEMPLATE_LABELS = [
  ["PROJECT NAME", "projectName"],
  ["LOCATION OF WORK", "location"],
  ["PROJECT MANAGER", "projectManager"],
  ["DATE OF REQUEST", "date"],
  ["DESCRIPTION OF CHANGES NEEDED", "description"],
  ["DESCRIPTION OF CHANGES", "description"],
  ["REASON FOR CHANGE", "reason"],
  ["NET INCREASE / DECREASE", "totalText"],
  ["NET INCREASE", "totalText"],
  ["TOTAL CONTRACT PRICE WITH APPROVED CHANGES", "newContractText"],
];

function labelKey_(text) {
  return String(text || "").toUpperCase().replace(/[^A-Z/ ]+/g, " ").replace(/\s+/g, " ").trim();
}

function fillTemplateTables_(body, doc) {
  var values = {
    projectName: doc.projectName, location: doc.location, projectManager: doc.projectManager, date: doc.date,
    number: doc.number ? String(doc.number) : "", description: doc.description, reason: doc.reason,
    totalText: formatMoney(doc.total), newContractText: doc.newContractPrice != null ? formatMoney(doc.newContractPrice) : "",
  };
  var lookup = {};
  TEMPLATE_LABELS.forEach(function (p) { lookup[p[0]] = p[1]; });
  body.getTables().forEach(function (table) {
    for (var r = 0; r < table.getNumRows(); r++) {
      var row = table.getRow(r);
      for (var c = 0; c < row.getNumCells() - 1; c++) {
        var key = lookup[labelKey_(row.getCell(c).getText())];
        var value = key && values[key];
        if (!value) continue;
        var target = row.getCell(c + 1);
        if (labelKey_(target.getText()) && lookup[labelKey_(target.getText())]) continue; // next cell is another label
        target.setText(String(value));
      }
    }
  });
}

function materialsRows_(doc) {
  var rows = [["Vendor", "Item", "Qty", "Amount"]];
  doc.lines.forEach(function (l) {
    var qty = (l.qty || 1) + (l.unit ? " " + l.unit : "");
    rows.push([l.vendor || "", l.description || "", qty, formatMoney(l.amount)]);
  });
  rows.push(["", "Total", "", formatMoney(doc.total)]);
  return rows;
}

function styleMaterialsTable_(table) {
  var header = table.getRow(0);
  for (var c = 0; c < header.getNumCells(); c++) header.getCell(c).editAsText().setBold(true);
  var last = table.getRow(table.getNumRows() - 1);
  for (var d = 0; d < last.getNumCells(); d++) last.getCell(d).editAsText().setBold(true);
  table.setBorderColor("#c9ced4");
}

function insertMaterials_(body, doc) {
  var index = body.getNumChildren();
  for (var i = 0; i < body.getNumChildren(); i++) {
    var el = body.getChild(i);
    if (el.getType() === DocumentApp.ElementType.PARAGRAPH && /signature/i.test(el.asParagraph().getText())) { index = i; break; }
  }
  body.insertParagraph(index, "MATERIALS").setHeading(DocumentApp.ParagraphHeading.HEADING3);
  var table = body.insertTable(index + 1, materialsRows_(doc));
  styleMaterialsTable_(table);
  body.insertParagraph(index + 2, "");
}

/** Build a document from scratch (invoices, or change orders when no template is set). */
function writeGeneratedDoc_(body, doc) {
  var company = setting_("COMPANY_NAME");
  if (company) body.appendParagraph(company).editAsText().setBold(true);
  if (setting_("COMPANY_ADDRESS")) body.appendParagraph(setting_("COMPANY_ADDRESS"));
  body.appendParagraph(doc.title.toUpperCase()).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  var info = doc.kind === "change_order"
    ? [["Project name", doc.projectName], ["Location of work", doc.location], ["Change order #", String(doc.number)],
       ["Project manager", doc.projectManager], ["Date of request", doc.date],
       ["Description of changes", doc.description], ["Reason for change", doc.reason]]
    : [["Bill to / Project", doc.projectName], ["Location of work", doc.location], ["Invoice #", String(doc.number || "")], ["Date", doc.date]];
  body.appendTable(info.map(function (r) { return [r[0], r[1] || ""]; })).setBorderColor("#dfe2e6");
  body.appendParagraph("MATERIALS").setHeading(DocumentApp.ParagraphHeading.HEADING3);
  styleMaterialsTable_(body.appendTable(materialsRows_(doc)));
  if (doc.newContractPrice != null) {
    body.appendTable([
      ["Net increase", formatMoney(doc.total)],
      ["Previous contract price", formatMoney(doc.previousContractPrice)],
      ["Total contract price with approved changes", formatMoney(doc.newContractPrice)],
    ]).setBorderColor("#dfe2e6");
  }
  if (doc.kind === "change_order") {
    body.appendParagraph("\n\n______________________________        ______________________________");
    body.appendParagraph("Contractor signature & date                      Customer approval signature & date");
  } else {
    body.appendParagraph("Thank you for your business.");
  }
}

/**
 * Create the customer document in the right job subfolder. Returns { docId, pdfId, name, url }.
 * doc: result of buildCustomerDocument()
 */
function createCustomerDoc_(jobFolder, doc) {
  var folder = doc.kind === "change_order"
    ? ensureFolderPath_(jobFolder, setting_("CHANGE_ORDERS_PATH"))
    : ensureFolderPath_(jobFolder, setting_("INVOICES_SUBFOLDER"));
  var templateId = doc.kind === "change_order" ? setting_("CHANGE_ORDER_TEMPLATE_ID") : "";
  var file;
  if (templateId) {
    file = DriveApp.getFileById(templateId).makeCopy(doc.name, folder);
    var d = DocumentApp.openById(file.getId());
    fillTemplateTables_(d.getBody(), doc);
    insertMaterials_(d.getBody(), doc);
    d.saveAndClose();
  } else {
    var created = DocumentApp.create(doc.name);
    writeGeneratedDoc_(created.getBody(), doc);
    created.saveAndClose();
    file = DriveApp.getFileById(created.getId());
    file.moveTo(folder);
  }
  var pdf = folder.createFile(file.getAs("application/pdf")).setName(doc.name + ".pdf");
  return { docId: file.getId(), pdfId: pdf.getId(), name: doc.name, url: file.getUrl() };
}

// ===== Jobs.gs =====
// Job folders: one folder per job inside JOBS_FOLDER_ID, named the way the office names them.

function listJobs_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get("jobs");
  if (hit) return JSON.parse(hit);
  var rootId = setting_("JOBS_FOLDER_ID");
  if (!rootId) throw new Error("Set JOBS_FOLDER_ID in Script properties to the folder that holds your job folders.");
  var jobs = [];
  var it = DriveApp.getFolderById(rootId).getFolders();
  while (it.hasNext()) {
    var f = it.next();
    jobs.push({ id: f.getId(), name: f.getName().trim() });
  }
  jobs.sort(function (a, b) { return a.name.localeCompare(b.name); });
  cache.put("jobs", JSON.stringify(jobs), 600);
  return jobs;
}

function jobById_(id) {
  if (String(id).indexOf("new:") === 0) return newJobFolder_(String(id).slice(4));
  var job = listJobs_().filter(function (j) { return j.id === id; })[0];
  if (!job) throw new Error("That job folder no longer exists. Refresh and pick the job again.");
  return job;
}

/** Find or create a nested subfolder, e.g. "Project Management/Change Orders". Matches names case-insensitively. */
function ensureFolderPath_(parent, path) {
  var folder = parent;
  String(path).split("/").map(function (s) { return s.trim(); }).filter(String).forEach(function (name) {
    var found = null;
    var it = folder.getFolders();
    while (it.hasNext() && !found) {
      var f = it.next();
      if (f.getName().trim().toLowerCase() === name.toLowerCase()) found = f;
    }
    folder = found || folder.createFolder(name);
  });
  return folder;
}

/** Names of existing change orders in a job, used for numbering (files and folders). */
function existingChangeOrderNames_(coFolder) {
  var names = [];
  var fi = coFolder.getFiles();
  while (fi.hasNext()) names.push(fi.next().getName());
  var di = coFolder.getFolders();
  while (di.hasNext()) names.push(di.next().getName());
  return names;
}

/** A job read off a receipt that has no folder yet: use a folder with that name, or make one. */
function newJobFolder_(name) {
  name = String(name).trim().replace(/[\\/]+/g, "-").slice(0, 120);
  if (!name) throw new Error("Pick the job first.");
  var same = listJobs_().filter(function (j) { return j.name.toLowerCase() === name.toLowerCase(); })[0];
  if (same) return same;
  var f = DriveApp.getFolderById(setting_("JOBS_FOLDER_ID")).createFolder(name);
  CacheService.getScriptCache().remove("jobs");
  return { id: f.getId(), name: name };
}

// ===== QuickBooks.gs =====
// QuickBooks Online connection (OAuth 2.0 via the Apps Script OAuth2 library).
// Admin clicks "Connect QuickBooks" once; tokens are stored in Script Properties.
// Intuit docs: https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0

function qboService_() {
  return OAuth2.createService("QuickBooks")
    .setAuthorizationBaseUrl("https://appcenter.intuit.com/connect/oauth2")
    .setTokenUrl("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer")
    .setClientId(setting_("QBO_CLIENT_ID"))
    .setClientSecret(setting_("QBO_CLIENT_SECRET"))
    .setCallbackFunction("qboAuthCallback")
    .setPropertyStore(PropertiesService.getScriptProperties())
    .setScope("com.intuit.quickbooks.accounting")
    .setTokenHeaders({ Authorization: "Basic " + Utilities.base64Encode(setting_("QBO_CLIENT_ID") + ":" + setting_("QBO_CLIENT_SECRET")) });
}

function qboAuthCallback(request) {
  var ok = qboService_().handleCallback(request);
  if (ok && request.parameter.realmId) {
    PropertiesService.getScriptProperties().setProperty("QBO_REALM_ID", request.parameter.realmId);
  }
  return HtmlService.createHtmlOutput(ok
    ? "<p style='font-family:sans-serif'>QuickBooks is connected. You can close this tab.</p>"
    : "<p style='font-family:sans-serif'>QuickBooks connection was cancelled.</p>");
}

/** True when QuickBooks is set up and connected. Works before the OAuth2 library is added. */
function qboReady_() {
  return typeof OAuth2 !== "undefined" && !!setting_("QBO_CLIENT_ID") && qboService_().hasAccess();
}

function qboStatus_() {
  requireAdmin_();
  if (typeof OAuth2 === "undefined") return { connected: false, reason: "Not set up yet. See \"Connect QuickBooks\" in the setup guide." };
  if (!setting_("QBO_CLIENT_ID")) return { connected: false, reason: "Add QBO_CLIENT_ID and QBO_CLIENT_SECRET in Script properties." };
  var svc = qboService_();
  if (!svc.hasAccess()) return { connected: false, authUrl: svc.getAuthorizationUrl() };
  return { connected: true, environment: setting_("QBO_ENVIRONMENT") };
}

function qboDisconnect_() {
  requireAdmin_();
  qboService_().reset();
  PropertiesService.getScriptProperties().deleteProperty("QBO_REALM_ID");
}

function qboRequest_(method, path, body) {
  var svc = qboService_();
  if (!svc.hasAccess()) throw new Error("QuickBooks isn't connected. Open Settings and click Connect QuickBooks.");
  var realm = PropertiesService.getScriptProperties().getProperty("QBO_REALM_ID");
  var url = qboBaseUrl(realm, setting_("QBO_ENVIRONMENT") === "sandbox") + path +
    (path.indexOf("?") >= 0 ? "&" : "?") + "minorversion=" + QBO_MINOR_VERSION;
  var res = UrlFetchApp.fetch(url, {
    method: method,
    headers: { Authorization: "Bearer " + svc.getAccessToken(), Accept: "application/json" },
    contentType: "application/json",
    payload: body ? JSON.stringify(body) : undefined,
    muteHttpExceptions: true,
  });
  var data = {};
  try { data = JSON.parse(res.getContentText()); } catch (e) { data = {}; }
  if (res.getResponseCode() >= 400) {
    var fault = data.Fault && data.Fault.Error && data.Fault.Error[0];
    throw new Error("QuickBooks: " + (fault ? fault.Message + (fault.Detail ? " (" + fault.Detail + ")" : "") : "HTTP " + res.getResponseCode()));
  }
  return data;
}

function qboQuery_(q) {
  var data = qboRequest_("get", "/query?query=" + encodeURIComponent(q));
  return data.QueryResponse || {};
}

function qboFindOrCreate_(entity, name, createBody) {
  var found = qboQuery_(qboFindByNameQuery(entity, name))[entity];
  if (found && found.length) return found[0].Id;
  return qboRequest_("post", "/" + entity.toLowerCase(), createBody)[entity].Id;
}

function qboAccountId_(name) {
  var acct = qboQuery_("select * from Account where Name = " + qboQuote(name))["Account"];
  if (!acct || !acct.length) throw new Error("QuickBooks account \"" + name + "\" was not found. Check the name in Settings.");
  return acct[0].Id;
}

function qboItemId_(name) {
  var item = qboQuery_(qboFindByNameQuery("Item", name))["Item"];
  if (!item || !item.length) throw new Error("QuickBooks product/service \"" + name + "\" was not found. Create it (Non-inventory or Service) or change QBO_MATERIALS_ITEM.");
  return item[0].Id;
}

/**
 * Send an approved receipt to QuickBooks.
 * Returns { customerId, salesEntity, salesId, salesNumber, expenseIds }
 */
function sendToQuickBooks_(kind, job, priced, receipt, info) {
  var customerId = qboFindOrCreate_("Customer", job.name, qboCustomerBody(job));
  var itemId = qboItemId_(setting_("QBO_MATERIALS_ITEM"));
  var entity = kind === "change_order" ? "Estimate" : "Invoice";
  var sales = qboRequest_("post", "/" + entity.toLowerCase(), qboSalesBody(priced, { customerId: customerId, materialsItemId: itemId }, {
    kind: kind, date: info.date, number: info.number, jobName: job.name,
    memo: "From receipt " + (receipt.extracted.receiptNumber || receipt.id) + " uploaded by " + receipt.uploadedBy,
  }))[entity];

  var expenseIds = [];
  if (settingBool_("QBO_RECORD_EXPENSES") && setting_("QBO_PAYMENT_ACCOUNT")) {
    var vendorId = qboFindOrCreate_("Vendor", receipt.extracted.vendor || "Unknown vendor", qboVendorBody(receipt.extracted.vendor || "Unknown vendor"));
    var purchase = qboRequest_("post", "/purchase", qboExpenseBody(priced, {
      vendorId: vendorId, customerId: customerId,
      paymentAccountId: qboAccountId_(setting_("QBO_PAYMENT_ACCOUNT")),
      expenseAccountId: qboAccountId_(setting_("QBO_EXPENSE_ACCOUNT")),
      paymentType: setting_("QBO_PAYMENT_TYPE"),
    }, { date: receipt.extracted.date || info.date, employee: receipt.employee, receiptNumber: receipt.extracted.receiptNumber }))["Purchase"];
    expenseIds.push(purchase.Id);
  }
  return { customerId: customerId, salesEntity: entity, salesId: sales.Id, salesNumber: sales.DocNumber || "", expenseIds: expenseIds };
}

// ===== Store.gs =====
// Receipt records are stored in a Google Sheet owned by the admin (employees never open it).
// One row per receipt; the extracted data and pricing are stored as JSON.

var RECEIPT_COLUMNS = [
  "id", "createdAt", "uploadedBy", "employee", "source", "status", "jobId", "jobName",
  "fileId", "fileName", "note", "suggestedAction", "extracted", "match", "markupPercent",
  "action", "cost", "billed", "profit", "docId", "docName", "qbo", "error", "approvedBy", "approvedAt", "externalId",
];

var STATUS = { READING: "reading", REVIEW: "needs_review", READY: "ready", APPROVED: "approved", ERROR: "error" };

function receiptSheet_() {
  var id = setting_("DB_SPREADSHEET_ID");
  if (!id) throw new Error("Run setup() once from the Apps Script editor first.");
  var ss = SpreadsheetApp.openById(id);
  var sh = ss.getSheetByName("Receipts");
  if (!sh) {
    sh = ss.insertSheet("Receipts");
    sh.getRange(1, 1, 1, RECEIPT_COLUMNS.length).setValues([RECEIPT_COLUMNS]).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh;
}

function rowToReceipt_(row) {
  var r = {};
  RECEIPT_COLUMNS.forEach(function (c, i) { r[c] = row[i]; });
  ["extracted", "match", "qbo"].forEach(function (k) {
    try { r[k] = r[k] ? JSON.parse(r[k]) : null; } catch (e) { r[k] = null; }
  });
  ["cost", "billed", "profit", "markupPercent"].forEach(function (k) { r[k] = r[k] === "" ? null : Number(r[k]); });
  if (r.createdAt instanceof Date) r.createdAt = r.createdAt.toISOString();
  if (r.approvedAt instanceof Date) r.approvedAt = r.approvedAt.toISOString();
  return r;
}

function receiptToRow_(r) {
  return RECEIPT_COLUMNS.map(function (c) {
    var v = r[c];
    if (v == null) return "";
    if (typeof v === "object" && !(v instanceof Date)) return JSON.stringify(v);
    return v;
  });
}

function allReceipts_() {
  var sh = receiptSheet_();
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, RECEIPT_COLUMNS.length).getValues().map(rowToReceipt_);
}

function findReceiptRow_(id) {
  var sh = receiptSheet_();
  var n = sh.getLastRow() - 1;
  if (n < 1) return -1;
  var ids = sh.getRange(2, 1, n, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (ids[i][0] === id) return i + 2;
  return -1;
}

function getReceipt_(id) {
  var row = findReceiptRow_(id);
  if (row < 0) throw new Error("Receipt not found.");
  return rowToReceipt_(receiptSheet_().getRange(row, 1, 1, RECEIPT_COLUMNS.length).getValues()[0]);
}

function saveReceipt_(r) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = receiptSheet_();
    var row = r.id ? findReceiptRow_(r.id) : -1;
    if (row < 0) {
      if (!r.id) r.id = Utilities.getUuid();
      if (!r.createdAt) r.createdAt = new Date().toISOString();
      sh.appendRow(receiptToRow_(r));
    } else {
      sh.getRange(row, 1, 1, RECEIPT_COLUMNS.length).setValues([receiptToRow_(r)]);
    }
    return r;
  } finally {
    lock.releaseLock();
  }
}

/** What a user may see: admins see everything, employees only their own uploads. */
function visibleReceipts_(email) {
  var list = allReceipts_();
  if (!isAdmin_(email)) list = list.filter(function (r) { return String(r.uploadedBy).toLowerCase() === String(email).toLowerCase(); });
  return list.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
}

/** Employee-safe view: no cost, markup or profit. */
function employeeView_(r) {
  return {
    id: r.id, createdAt: r.createdAt, status: r.status, jobName: r.jobName, note: r.note,
    vendor: r.extracted && r.extracted.vendor, total: r.extracted && r.extracted.total,
    items: r.extracted ? r.extracted.items.length : 0, error: r.error, action: r.status === STATUS.APPROVED ? r.action : "",
  };
}

// ===== core/pricing.js =====
// Pricing: turns an extracted receipt into cost, markup, billed price and profit.
// Plain function declarations so the same file runs in Google Apps Script and Node tests.

var DEFAULT_MARKUP_PERCENT = 28;

// Rounds half-cents up (627.555 -> 627.56). Shifting through the exponent avoids
// binary float error: 627.555 * 100 is 62755.49999... but Number("627.555e2") is 62755.5.
function roundCents(n) {
  var v = Number(n) || 0;
  var sign = v < 0 ? -1 : 1;
  var abs = Math.abs(v);
  if (/e/i.test(String(abs))) return sign * (Math.round(abs * 100) / 100); // 1e-7, 1e21 etc.
  return sign * Number(Math.round(Number(abs + "e2")) + "e-2");
}

/**
 * Price a receipt.
 * receipt: { vendor, items: [{ description, qty, lineTotal, vendor? , markupPercent? }], tax, total }
 * options: { markupPercent (default 28), includeTaxInCost (default true) }
 *
 * Sales tax paid at the store is a real cost to the business, so by default it is
 * spread across the lines in proportion to their pre-tax amount; the last line
 * absorbs rounding so line costs always add up to the receipt total.
 */
function priceReceipt(receipt, options) {
  options = options || {};
  var markup = options.markupPercent == null ? DEFAULT_MARKUP_PERCENT : Number(options.markupPercent);
  var includeTax = options.includeTaxInCost !== false;
  var items = receipt.items || [];
  var subtotal = roundCents(items.reduce(function (s, it) { return s + Number(it.lineTotal || 0); }, 0));
  var tax = includeTax ? roundCents(receipt.tax || 0) : 0;

  var allocated = 0;
  var lines = items.map(function (it, i) {
    var pre = roundCents(it.lineTotal || 0);
    var share;
    if (i === items.length - 1) share = roundCents(tax - allocated);
    else share = subtotal > 0 ? roundCents(tax * (pre / subtotal)) : 0;
    allocated = roundCents(allocated + share);
    var cost = roundCents(pre + share);
    var m = it.markupPercent == null ? markup : Number(it.markupPercent);
    var billed = roundCents(cost * (1 + m / 100));
    return {
      vendor: it.vendor || receipt.vendor || "",
      description: it.description || "",
      qty: it.qty == null ? 1 : Number(it.qty),
      unit: it.unit || "",
      cost: cost,
      markupPercent: m,
      billed: billed,
      profit: roundCents(billed - cost),
    };
  });

  var cost = roundCents(lines.reduce(function (s, l) { return s + l.cost; }, 0));
  var billed = roundCents(lines.reduce(function (s, l) { return s + l.billed; }, 0));
  var profit = roundCents(billed - cost);
  return {
    lines: lines,
    totals: {
      subtotal: subtotal,
      tax: tax,
      cost: cost,
      billed: billed,
      profit: profit,
      marginPercent: billed > 0 ? roundCents((profit / billed) * 100) : 0,
    },
  };
}

/** Combine several priced receipts (e.g. one change order covering two store runs). */
function combinePriced(pricedList) {
  var lines = [];
  pricedList.forEach(function (p) { lines = lines.concat(p.lines); });
  var cost = roundCents(lines.reduce(function (s, l) { return s + l.cost; }, 0));
  var billed = roundCents(lines.reduce(function (s, l) { return s + l.billed; }, 0));
  var profit = roundCents(billed - cost);
  return {
    lines: lines,
    totals: {
      subtotal: roundCents(pricedList.reduce(function (s, p) { return s + p.totals.subtotal; }, 0)),
      tax: roundCents(pricedList.reduce(function (s, p) { return s + p.totals.tax; }, 0)),
      cost: cost,
      billed: billed,
      profit: profit,
      marginPercent: billed > 0 ? roundCents((profit / billed) * 100) : 0,
    },
  };
}

function formatMoney(n) {
  var v = roundCents(n);
  var s = Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (v < 0 ? "-$" : "$") + s;
}

// ===== core/match.js =====
// Job matching: finds the job folder a receipt belongs to from a customer name
// and/or address, using the folder names exactly as they appear in Drive.

var ADDRESS_WORDS = {
  st: "street", str: "street", ave: "avenue", av: "avenue", dr: "drive", ln: "lane", rd: "road",
  blvd: "boulevard", ct: "court", cir: "circle", pl: "place", pkwy: "parkway", hwy: "highway",
  ter: "terrace", trl: "trail", cv: "cove", wy: "way",
  n: "north", s: "south", e: "east", w: "west", ne: "northeast", nw: "northwest", se: "southeast", sw: "southwest",
};
// Words that carry no identifying signal on their own.
var MATCH_STOPWORDS = { the: 1, and: 1, of: 1, lot: 1, llc: 1, inc: 1 };

function matchTokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/(\d+)(st|nd|rd|th)\b/g, "$1") // 164th -> 164
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(function (t) { return ADDRESS_WORDS[t] || t; })
    .filter(function (t) { return !MATCH_STOPWORDS[t]; });
}

// House numbers (3+ digits, or the first number in an address) are the strongest signal.
function houseNumbers(tokens) {
  return tokens.filter(function (t) { return /^\d{3,6}$/.test(t); });
}

/**
 * Score how well a hint ("Whitfield", "4410 Maple Ridge Dr") matches a job folder name.
 * Returns 0..1.
 */
function scoreJob(hint, jobName) {
  var h = matchTokens(hint), j = matchTokens(jobName);
  if (!h.length || !j.length) return 0;
  var jSet = {};
  j.forEach(function (t) { jSet[t] = true; });

  var hNums = houseNumbers(h), jNums = houseNumbers(j);
  var numScore = 0;
  if (hNums.length && jNums.length) {
    var shared = hNums.filter(function (n) { return jSet[n]; }).length;
    numScore = shared ? 1 : -1; // a different house number is strong evidence against
  }

  var words = h.filter(function (t) { return !/^\d+$/.test(t) && t.length > 1; });
  var wordHits = words.filter(function (t) { return jSet[t]; }).length;
  var wordScore = words.length ? wordHits / words.length : 0;

  var score;
  if (numScore === 1) score = 0.6 + 0.4 * wordScore;
  else if (numScore === -1) score = 0.15 * wordScore;
  else score = 0.85 * wordScore;
  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

/**
 * Match a receipt to a job.
 * hints: array of strings (customer name, address, job name from the email or receipt)
 * jobs:  array of job folder names (or {name, id} objects)
 * Returns { job, score, confident, candidates: [{job, score}] (top 5) }
 */
function matchJob(hints, jobs) {
  var list = (jobs || []).map(function (j) { return typeof j === "string" ? { name: j } : j; });
  var hintList = (hints || []).filter(function (x) { return x && String(x).trim(); });
  var combined = hintList.join(" ");
  var scored = list.map(function (job) {
    var best = scoreJob(combined, job.name);
    hintList.forEach(function (hint) { best = Math.max(best, scoreJob(hint, job.name)); });
    return { job: job, score: best };
  }).sort(function (a, b) { return b.score - a.score; });

  var top = scored[0], second = scored[1];
  var confident = !!top && top.score >= 0.6 && (!second || top.score - second.score >= 0.15);
  return {
    job: top && top.score > 0 ? top.job : null,
    score: top ? top.score : 0,
    confident: confident,
    candidates: scored.slice(0, 5).filter(function (c) { return c.score > 0; }),
  };
}

// ===== core/documents.js =====
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

// ===== core/quickbooks.js =====
// QuickBooks Online: builds API request bodies. The adapter sends them with OAuth.
// Change orders become Estimates, invoices become Invoices, and the receipt's cost is
// recorded as an Expense (Purchase) against the job so job costing stays accurate.
// Docs: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice

var QBO_MINOR_VERSION = 75;

function qboBaseUrl(realmId, sandbox) {
  var host = sandbox ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com";
  return host + "/v3/company/" + encodeURIComponent(realmId);
}

/** QuickBooks query strings use single quotes; escape any inside names. */
function qboQuote(value) {
  return "'" + String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

function qboFindByNameQuery(entity, name) {
  var field = entity === "Item" ? "Name" : "DisplayName";
  return "select * from " + entity + " where " + field + " = " + qboQuote(qboDisplayName(name));
}

// QuickBooks DisplayName: max 500 chars, no colon, tab or newline.
function qboDisplayName(name) {
  return String(name || "").replace(/[:\t\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

function qboLineDescription(line) {
  var parts = [];
  if (line.vendor) parts.push(line.vendor);
  var qty = line.qty && line.qty !== 1 ? line.qty + (line.unit ? " " + line.unit : "") + " " : "";
  parts.push(qty + line.description);
  return parts.join(" – ").slice(0, 4000);
}

/** New customer, named exactly like the job folder in Drive. */
function qboCustomerBody(job) {
  return { DisplayName: qboDisplayName(job.name), Notes: "Created by JobReceipts from job folder: " + job.name };
}

function qboVendorBody(vendorName) {
  return { DisplayName: qboDisplayName(vendorName) };
}

function salesLines(priced, itemId) {
  return priced.lines.map(function (l) {
    return {
      DetailType: "SalesItemLineDetail",
      Amount: l.billed,
      Description: qboLineDescription(l),
      SalesItemLineDetail: { ItemRef: { value: String(itemId) }, Qty: 1, UnitPrice: l.billed },
    };
  });
}

/**
 * Invoice or Estimate (change order) body.
 * refs: { customerId, materialsItemId }
 * info: { kind, date (YYYY-MM-DD), number, jobName, memo }
 */
function qboSalesBody(priced, refs, info) {
  var body = {
    CustomerRef: { value: String(refs.customerId) },
    TxnDate: info.date,
    Line: salesLines(priced, refs.materialsItemId),
    PrivateNote: info.memo || "",
  };
  if (info.kind === "change_order") {
    body.CustomerMemo = { value: "Change Order #" + info.number + " - " + info.jobName };
    body.DocNumber = ("CO" + info.number + "-" + String(info.jobName).replace(/[^A-Za-z0-9]/g, "")).slice(0, 21);
  } else {
    body.CustomerMemo = { value: "Materials - " + info.jobName };
  }
  return body;
}

/**
 * Expense (Purchase) for the receipt's cost, assigned to the job's customer for job costing.
 * refs: { vendorId, customerId, paymentAccountId, expenseAccountId, paymentType }
 * Lines are NotBillable because billing happens through the invoice or change order.
 */
function qboExpenseBody(priced, refs, info) {
  return {
    PaymentType: refs.paymentType || "CreditCard",
    AccountRef: { value: String(refs.paymentAccountId) },
    EntityRef: { value: String(refs.vendorId), type: "Vendor" },
    TxnDate: info.date,
    DocNumber: info.receiptNumber ? String(info.receiptNumber).slice(0, 21) : undefined,
    PrivateNote: (info.employee ? "Purchased by " + info.employee + ". " : "") + (info.memo || ""),
    Line: priced.lines.map(function (l) {
      return {
        DetailType: "AccountBasedExpenseLineDetail",
        Amount: l.cost,
        Description: qboLineDescription(l),
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: String(refs.expenseAccountId) },
          CustomerRef: { value: String(refs.customerId) },
          BillableStatus: "NotBillable",
        },
      };
    }),
  };
}

/** Readable summary of what will be sent, for the review screen. */
function qboPlan(kind, priced, job, info) {
  var plan = [];
  plan.push({
    entity: kind === "change_order" ? "Estimate" : "Invoice",
    label: kind === "change_order" ? "Change order as an Estimate" : "Invoice",
    customer: qboDisplayName(job.name),
    amount: priced.totals.billed,
    lines: priced.lines.length,
  });
  var vendors = {};
  priced.lines.forEach(function (l) { vendors[l.vendor || "Unknown vendor"] = true; });
  Object.keys(vendors).forEach(function (v) {
    var cost = roundCents(priced.lines.filter(function (l) { return (l.vendor || "Unknown vendor") === v; })
      .reduce(function (s, l) { return s + l.cost; }, 0));
    plan.push({ entity: "Purchase", label: "Expense (job cost)", vendor: v, customer: qboDisplayName(job.name), amount: cost });
  });
  return plan;
}

// ===== core/extract.js =====
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
    isReceipt: { type: "boolean", description: "False if the file is not a supplier receipt, invoice, delivery ticket or packing slip" },
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
          lineTotal: { type: "number", description: "Extended price for the line after any line discount, before tax; 0 if no price is printed" },
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
  "- A bill-to or ship-to address under the buyer's own company name (their office or shop, common on pickups) is not a job site; leave address empty unless it is a job site.",
  "- jobGuess: pick the exact matching folder name from the job list only if you are confident; otherwise leave it empty.",
  "- Delivery tickets, pick tickets and packing slips often show no prices. Read them anyway: use 0 for any price that isn't printed and say so in notes.",
  "- Include handwritten additions as items and mention them in notes.",
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
  var unpriced = items.filter(function (it) { return !it.lineTotal; });
  if (items.length && unpriced.length === items.length) {
    flags.push("No prices on this receipt (delivery tickets and packing slips usually have none). Type in what each line cost before approving.");
  } else if (unpriced.length) {
    flags.push("No price on: " + unpriced.map(function (it) { return it.description; }).join("; ") + ". Type in what it cost before approving.");
  }
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
