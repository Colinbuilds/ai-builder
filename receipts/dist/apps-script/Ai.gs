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
