// JobReceipts web app: entry point, receipt pipeline and the functions the page calls.
// Deployed as a web app that runs as the admin who deployed it and is open to people in
// your Google Workspace domain. Every function below checks who is calling.

function doGet(e) {
  var t = HtmlService.createTemplateFromFile("Index");
  return t.evaluate()
    .setTitle("JobReceipts")
    .addMetaTag("viewport", "width=device-width, initial-scale=1, viewport-fit=cover")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// ------------------------------------------------------------------ one-time setup

/** Run once from the editor: creates the records sheet and inbox folder. */
function setup() {
  requireOwnerOrAdmin_();
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty("DB_SPREADSHEET_ID")) {
    var ss = SpreadsheetApp.create("JobReceipts records (do not edit)");
    props.setProperty("DB_SPREADSHEET_ID", ss.getId());
  }
  receiptSheet_();
  if (!props.getProperty("INBOX_FOLDER_ID")) {
    props.setProperty("INBOX_FOLDER_ID", DriveApp.createFolder("JobReceipts inbox").getId());
  }
  return "Setup complete.";
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
  var priced = priceReceipt(extracted, { markupPercent: settingNumber_("DEFAULT_MARKUP_PERCENT"), includeTaxInCost: settingBool_("INCLUDE_TAX_IN_COST") });

  receipt.extracted = extracted;
  receipt.match = { confident: match.confident, score: match.score, aiSuggestion: match.aiSuggestion || "",
    candidates: (match.candidates || []).map(function (c) { return { id: c.job.id, name: c.job.name, score: c.score }; }) };
  if (match.job) { receipt.jobId = match.job.id; receipt.jobName = match.job.name; }
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
 * input: { base64, mimeType, fileName, jobId, note, suggestedAction }
 */
function apiUpload(input) {
  var email = requireUser_();
  if (!input || !input.base64) throw new Error("Take or choose a photo of the receipt first.");
  if (!input.jobId) throw new Error("Pick the job this receipt is for.");
  var job = jobById_(input.jobId);
  var blob = Utilities.newBlob(Utilities.base64Decode(input.base64), input.mimeType || "image/jpeg",
    (input.fileName || "receipt") .replace(/[\\/:*?"<>|]+/g, "-"));
  var name = email.split("@")[0];
  var receipt = {
    source: "upload", uploadedBy: email, employee: "", status: STATUS.READING, jobId: job.id, jobName: job.name,
    note: String(input.note || "").slice(0, 1000), suggestedAction: input.suggestedAction || "",
  };
  saveReceipt_(receipt);
  try {
    processReceiptFile_(receipt, blob, {
      from: name, subject: "Receipt for " + job.name, body: receipt.note, receivedAt: new Date().toISOString(),
    }, job.id);
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
  if (r.status !== STATUS.ERROR) r.status = r.jobId ? STATUS.READY : STATUS.REVIEW;
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
    var jobFolder = DriveApp.getFolderById(job.id);
    var markup = opts.markupPercent != null ? Number(opts.markupPercent) : r.markupPercent;
    var priced = priceReceipt(r.extracted, { markupPercent: markup, includeTaxInCost: settingBool_("INCLUDE_TAX_IN_COST") });
    var date = opts.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

    var number = "";
    if (opts.action === "change_order") {
      number = nextChangeOrderNumber(existingChangeOrderNames_(ensureFolderPath_(jobFolder, setting_("CHANGE_ORDERS_PATH"))));
    }
    var qbo = null;
    if (qboService_().hasAccess()) {
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
  };
}
