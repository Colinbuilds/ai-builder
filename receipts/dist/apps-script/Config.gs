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
