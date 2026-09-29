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
