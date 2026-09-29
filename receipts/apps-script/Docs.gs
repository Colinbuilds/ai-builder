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
