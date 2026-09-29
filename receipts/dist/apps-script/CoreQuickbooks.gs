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
