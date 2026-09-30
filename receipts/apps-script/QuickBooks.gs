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
