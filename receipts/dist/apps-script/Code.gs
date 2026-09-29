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
