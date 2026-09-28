// Free calculators for the industry landing pages. Pure functions + a small renderer.
// Each calculator: inputs (form fields), compute(values) -> { outputs, takeaway }.
(function (root) {
  "use strict";

  var usd = function (n) {
    var r = Math.round(n);
    return (r < 0 ? "-$" : "$") + Math.abs(r).toLocaleString("en-US");
  };
  var pct = function (n, d) { return (n * 100).toFixed(d == null ? 1 : d).replace(/\.0$/, "") + "%"; };
  var num = function (n, d) {
    return Number(n).toLocaleString("en-US", { maximumFractionDigits: d == null ? 1 : d });
  };
  var roundTo = function (n, step) { return Math.round(n / step) * step; };

  var CALCS = {
    "unsold-quotes": {
      title: "Unsold quote calculator",
      inputs: [
        { id: "quotes", label: "Quotes you give per month", value: 40, min: 1, step: 1 },
        { id: "avgJob", label: "Average job value", value: 1800, min: 1, step: 50, prefix: "$" },
        { id: "closeRate", label: "Your close rate today", value: 30, min: 0, max: 100, step: 1, suffix: "%" },
        { id: "target", label: "Close rate with steady follow-up", value: 40, min: 0, max: 100, step: 1, suffix: "%" },
      ],
      compute: function (v) {
        var c = v.closeRate / 100, t = Math.max(v.target / 100, c);
        var unsold = v.quotes * (1 - c);
        var extraJobs = v.quotes * (t - c);
        var extraYear = extraJobs * v.avgJob * 12;
        return {
          outputs: [
            { label: "Quotes that go unsold each month", value: num(unsold, 0) },
            { label: "Value of unsold quotes per month", value: usd(unsold * v.avgJob) },
            { label: "Extra jobs per month at " + pct(t, 0), value: num(extraJobs, 1) },
            { label: "Extra revenue per year", value: usd(extraYear), big: true },
          ],
          takeaway: "Closing " + pct(t, 0) + " of your quotes instead of " + pct(c, 0) + " is worth about " +
            usd(extraYear) + " a year, from quotes you've already written.",
        };
      },
    },

    "cleaning-price": {
      title: "Cleaning price calculator",
      inputs: [
        { id: "sqft", label: "Home size", value: 2000, min: 100, step: 50, suffix: "sq ft" },
        { id: "bedrooms", label: "Bedrooms", value: 3, min: 0, step: 1 },
        { id: "bathrooms", label: "Bathrooms", value: 2, min: 0, step: 0.5 },
        { id: "rate", label: "Your hourly rate per cleaner", value: 55, min: 1, step: 1, prefix: "$" },
        { id: "cleaners", label: "Cleaners on the job", value: 2, min: 1, step: 1 },
        { id: "frequency", label: "Frequency", type: "select", value: "biweekly",
          options: [["one-time", "One-time"], ["monthly", "Monthly (10% off)"], ["biweekly", "Every 2 weeks (15% off)"], ["weekly", "Weekly (20% off)"]] },
      ],
      compute: function (v) {
        // Labor-hour model: ~600 sq ft per hour, plus time per bathroom and bedroom.
        var hours = v.sqft / 600 + 0.5 * v.bathrooms + 0.25 * v.bedrooms;
        var disc = { "one-time": 0, monthly: 0.1, biweekly: 0.15, weekly: 0.2 }[v.frequency] || 0;
        var price = function (mult, recurring) { return roundTo(hours * mult * v.rate * (recurring ? 1 - disc : 1), 5); };
        var onSite = function (mult) { return num((hours * mult) / v.cleaners, 1) + " hrs on site"; };
        return {
          outputs: [
            { label: "Good: Standard clean · " + onSite(1), value: usd(price(1, true)) },
            { label: "Better: Deep clean · " + onSite(1.5), value: usd(price(1.5, false)), big: true },
            { label: "Best: Move-in / move-out · " + onSite(1.8), value: usd(price(1.8, false)) },
            { label: "Estimated labor hours (standard)", value: num(hours, 1) },
          ],
          takeaway: "Offering three options instead of one gives customers a way to say yes at their budget, and many will pick the middle option.",
        };
      },
      note: "Estimates only. The time model (about 600 sq ft per cleaner-hour, plus bathrooms and bedrooms) is a starting point: adjust your rate to your market.",
    },

    "freelance-rate": {
      title: "Freelance rate calculator",
      inputs: [
        { id: "income", label: "Take-home pay you want per year", value: 80000, min: 0, step: 1000, prefix: "$" },
        { id: "expenses", label: "Business expenses per year", value: 6000, min: 0, step: 500, prefix: "$" },
        { id: "tax", label: "Tax rate (estimate)", value: 25, min: 0, max: 90, step: 1, suffix: "%" },
        { id: "hours", label: "Billable hours per week", value: 25, min: 1, max: 80, step: 1 },
        { id: "weeksOff", label: "Weeks off per year", value: 6, min: 0, max: 51, step: 1 },
      ],
      compute: function (v) {
        var gross = (v.income + v.expenses) / (1 - v.tax / 100);
        var billable = v.hours * (52 - v.weeksOff);
        var hourly = gross / billable;
        return {
          outputs: [
            { label: "Minimum hourly rate", value: usd(hourly), big: true },
            { label: "Day rate (8 hours)", value: usd(roundTo(hourly * 8, 10)) },
            { label: "Starter package (about 10 hrs)", value: usd(roundTo(hourly * 10, 50)) },
            { label: "Standard package (about 25 hrs)", value: usd(roundTo(hourly * 25, 50)) },
            { label: "Premium package (about 50 hrs)", value: usd(roundTo(hourly * 50, 50)) },
            { label: "You need to invoice per year", value: usd(gross) },
          ],
          takeaway: "Anything under " + usd(hourly) + "/hour means you're working below your goal. Quote packages, not hours, so clients compare value, not your time.",
        };
      },
    },

    "raise-math": {
      title: "Fundraise calculator",
      inputs: [
        { id: "raise", label: "Amount you're raising", value: 1500000, min: 1, step: 50000, prefix: "$" },
        { id: "pre", label: "Pre-money valuation", value: 8000000, min: 1, step: 250000, prefix: "$" },
        { id: "cash", label: "Cash in the bank today", value: 150000, min: 0, step: 10000, prefix: "$" },
        { id: "burn", label: "Monthly burn after the raise", value: 90000, min: 1, step: 5000, prefix: "$" },
        { id: "check", label: "Average check size", value: 100000, min: 1, step: 5000, prefix: "$" },
        { id: "reply", label: "Investors who take a meeting", value: 20, min: 1, max: 100, step: 1, suffix: "%" },
        { id: "commit", label: "Meetings that turn into a check", value: 10, min: 1, max: 100, step: 1, suffix: "%" },
      ],
      compute: function (v) {
        var post = v.pre + v.raise;
        var investors = Math.ceil(v.raise / v.check);
        var meetings = Math.ceil(investors / (v.commit / 100));
        var contacts = Math.ceil(meetings / (v.reply / 100));
        return {
          outputs: [
            { label: "Post-money valuation", value: usd(post) },
            { label: "Dilution from this round", value: pct(v.raise / post) },
            { label: "Runway after the raise", value: num((v.cash + v.raise) / v.burn, 1) + " months" },
            { label: "Investors you need to commit", value: num(investors, 0) },
            { label: "Investor meetings you need", value: num(meetings, 0) },
            { label: "Investors to contact", value: num(contacts, 0), big: true },
          ],
          takeaway: "To close " + usd(v.raise) + " you should plan to reach about " + num(contacts, 0) +
            " investors and take " + num(meetings, 0) + " meetings. A fundraise is a sales pipeline, so run it like one.",
        };
      },
      note: "Simplified: ignores option-pool top-ups, SAFE conversion terms and fees.",
    },

    "no-show": {
      title: "No-show & lapsed client calculator",
      inputs: [
        { id: "appts", label: "Appointments per week", value: 60, min: 1, step: 1 },
        { id: "noShow", label: "No-show / late-cancel rate", value: 8, min: 0, max: 100, step: 0.5, suffix: "%" },
        { id: "ticket", label: "Average ticket", value: 75, min: 1, step: 5, prefix: "$" },
        { id: "lapsed", label: "Clients who haven't booked in 90+ days", value: 40, min: 0, step: 1 },
        { id: "winBack", label: "Share you could win back", value: 15, min: 0, max: 100, step: 1, suffix: "%" },
        { id: "visits", label: "Visits per client per year", value: 6, min: 1, step: 1 },
      ],
      compute: function (v) {
        var noShowYear = v.appts * 52 * (v.noShow / 100) * v.ticket;
        var winBackYear = v.lapsed * (v.winBack / 100) * v.ticket * v.visits;
        return {
          outputs: [
            { label: "Revenue lost to no-shows per year", value: usd(noShowYear) },
            { label: "Clients won back", value: num(v.lapsed * (v.winBack / 100), 0) },
            { label: "Revenue from won-back clients per year", value: usd(winBackYear) },
            { label: "Total opportunity per year", value: usd(noShowYear + winBackYear), big: true },
          ],
          takeaway: "Reminder texts cut no-shows, and a friendly \"we miss you\" message brings lapsed clients back. Together that's about " +
            usd(noShowYear + winBackYear) + " a year.",
        };
      },
    },

    "client-retention": {
      title: "Client retention calculator",
      inputs: [
        { id: "clients", label: "Active clients", value: 20, min: 1, step: 1 },
        { id: "fee", label: "Monthly fee per client", value: 200, min: 1, step: 10, prefix: "$" },
        { id: "churn", label: "Clients who quit each month", value: 10, min: 0.5, max: 100, step: 0.5, suffix: "%" },
        { id: "improved", label: "With regular check-ins", value: 6, min: 0.5, max: 100, step: 0.5, suffix: "%" },
      ],
      compute: function (v) {
        var c = v.churn / 100, i = Math.min(v.improved, v.churn) / 100;
        var ltv = v.fee / c, ltv2 = v.fee / i;
        var kept = v.clients * (c - i) * 12;
        return {
          outputs: [
            { label: "Average client stays", value: num(1 / c, 1) + " months" },
            { label: "Lifetime value per client today", value: usd(ltv) },
            { label: "Lifetime value with better retention", value: usd(ltv2) },
            { label: "Clients you'd keep per year", value: num(kept, 0) },
            { label: "Extra lifetime value per new client", value: usd(ltv2 - ltv), big: true },
          ],
          takeaway: "Cutting monthly drop-off from " + pct(c) + " to " + pct(i) + " makes every new client worth " +
            usd(ltv2 - ltv) + " more, without finding a single extra lead.",
        };
      },
    },

    "rental-cashflow": {
      title: "Rental cash flow calculator",
      inputs: [
        { id: "rent", label: "Monthly rent", value: 1800, min: 0, step: 25, prefix: "$" },
        { id: "mortgage", label: "Mortgage payment (principal + interest)", value: 1000, min: 0, step: 25, prefix: "$" },
        { id: "tax", label: "Property tax per year", value: 3000, min: 0, step: 100, prefix: "$" },
        { id: "insurance", label: "Insurance per year", value: 1200, min: 0, step: 50, prefix: "$" },
        { id: "vacancy", label: "Vacancy", value: 5, min: 0, max: 100, step: 1, suffix: "%" },
        { id: "maint", label: "Maintenance & repairs (of rent)", value: 8, min: 0, max: 100, step: 1, suffix: "%" },
        { id: "mgmt", label: "Property management (of rent)", value: 0, min: 0, max: 100, step: 1, suffix: "%" },
        { id: "other", label: "HOA / utilities / other per month", value: 0, min: 0, step: 10, prefix: "$" },
        { id: "price", label: "Purchase price", value: 250000, min: 1, step: 5000, prefix: "$" },
        { id: "invested", label: "Cash you put in (down payment + costs)", value: 60000, min: 1, step: 1000, prefix: "$" },
      ],
      compute: function (v) {
        var income = v.rent * (1 - v.vacancy / 100);
        var opex = v.tax / 12 + v.insurance / 12 + v.rent * (v.maint + v.mgmt) / 100 + v.other;
        var noi = income - opex;
        var cash = noi - v.mortgage;
        return {
          outputs: [
            { label: "Operating expenses per month", value: usd(opex) },
            { label: "Net operating income per month", value: usd(noi) },
            { label: "Cash flow per month", value: usd(cash), big: true },
            { label: "Cash flow per year", value: usd(cash * 12) },
            { label: "Cap rate", value: pct((noi * 12) / v.price) },
            { label: "Cash-on-cash return", value: pct((cash * 12) / v.invested) },
          ],
          takeaway: cash >= 0
            ? "This property clears about " + usd(cash) + " a month after all expenses and the mortgage."
            : "This property loses about " + usd(-cash) + " a month. Check the rent, expenses or financing before you buy.",
        };
      },
      note: "Estimates only; not financial advice. Excludes income tax effects, depreciation and appreciation.",
    },

    "agent-goal": {
      title: "Real estate income goal calculator",
      inputs: [
        { id: "goal", label: "Take-home income goal", value: 120000, min: 0, step: 5000, prefix: "$" },
        { id: "expenses", label: "Business expenses per year", value: 15000, min: 0, step: 1000, prefix: "$" },
        { id: "price", label: "Average sale price", value: 400000, min: 1, step: 10000, prefix: "$" },
        { id: "commission", label: "Your side's commission", value: 2.5, min: 0.1, max: 10, step: 0.1, suffix: "%" },
        { id: "split", label: "Your share after brokerage split", value: 70, min: 1, max: 100, step: 1, suffix: "%" },
        { id: "conversion", label: "Leads that become closings", value: 3, min: 0.1, max: 100, step: 0.1, suffix: "%" },
      ],
      compute: function (v) {
        var perDeal = v.price * (v.commission / 100) * (v.split / 100);
        var deals = Math.ceil((v.goal + v.expenses) / perDeal);
        var leads = Math.ceil(deals / (v.conversion / 100));
        return {
          outputs: [
            { label: "You earn per closing", value: usd(perDeal) },
            { label: "Closings needed this year", value: num(deals, 0), big: true },
            { label: "Closings per month", value: num(deals / 12, 1) },
            { label: "Leads needed this year", value: num(leads, 0) },
            { label: "Leads needed per week", value: num(leads / 52, 1) },
          ],
          takeaway: "To take home " + usd(v.goal) + " you need about " + num(deals, 0) + " closings, which means working roughly " +
            num(leads / 52, 0) + " new leads every week and following up with all of them.",
        };
      },
    },
  };

  // ---------------------------------------------------------------- renderer

  function render(container, id) {
    var calc = CALCS[id];
    if (!calc || !container) return;
    var doc = container.ownerDocument;
    var el = function (tag, cls, text) {
      var n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    };
    var form = el("form", "calc-form");
    form.noValidate = true;
    calc.inputs.forEach(function (f) {
      var wrap = el("label", "calc-field");
      wrap.appendChild(el("span", "calc-label", f.label));
      var box = el("span", "calc-input");
      var input;
      if (f.type === "select") {
        input = el("select");
        f.options.forEach(function (o) {
          var op = el("option", null, o[1]); op.value = o[0];
          if (o[0] === f.value) op.selected = true;
          input.appendChild(op);
        });
      } else {
        if (f.prefix) box.appendChild(el("span", "affix", f.prefix));
        input = el("input");
        input.type = "number"; input.inputMode = "decimal";
        input.value = f.value; input.step = f.step || "any";
        if (f.min != null) input.min = f.min;
        if (f.max != null) input.max = f.max;
      }
      input.name = f.id;
      box.appendChild(input);
      if (f.suffix) box.appendChild(el("span", "affix", f.suffix));
      wrap.appendChild(box);
      form.appendChild(wrap);
    });
    var out = el("div", "calc-out");
    out.setAttribute("aria-live", "polite");

    function update() {
      var v = {}, ok = true;
      calc.inputs.forEach(function (f) {
        var raw = form.elements[f.id].value;
        if (f.type === "select") { v[f.id] = raw; return; }
        var n = Number(raw);
        if (raw === "" || !isFinite(n) || (f.min != null && n < f.min) || (f.max != null && n > f.max)) ok = false;
        v[f.id] = n;
      });
      out.innerHTML = "";
      if (!ok) { out.appendChild(el("p", "calc-take", "Check the numbers above: one is empty or out of range.")); return; }
      var r = calc.compute(v);
      var grid = el("div", "calc-results");
      r.outputs.forEach(function (o) {
        var row = el("div", "calc-row" + (o.big ? " big" : ""));
        row.appendChild(el("span", null, o.label));
        row.appendChild(el("strong", null, o.value));
        grid.appendChild(row);
      });
      out.appendChild(grid);
      out.appendChild(el("p", "calc-take", r.takeaway));
      if (calc.note) out.appendChild(el("p", "calc-note", calc.note));
    }
    form.addEventListener("input", update);
    form.addEventListener("submit", function (e) { e.preventDefault(); update(); });
    container.innerHTML = "";
    container.appendChild(form);
    container.appendChild(out);
    update();
  }

  var api = { CALCS: CALCS, render: render };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Calculators = api;
})(this);
