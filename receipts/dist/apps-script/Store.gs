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
  if (!isAdmin_(email)) list = list.filter(function (r) { return String(r.uploadedBy).toLowerCase() === email; });
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
