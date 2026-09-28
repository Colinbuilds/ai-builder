// Waitlist form on the industry pages. Submits to a Google Form (responses land in
// its Google Sheet). Configure window.STORE.waitlist in site/config.js.
(function () {
  "use strict";
  var S = (window.STORE && window.STORE.waitlist) || {};
  var form = document.getElementById("waitlist");
  if (!form) return;

  // Remember where the visitor came from (?src=reddit or ?utm_source=facebook) for this visit.
  var source = "direct";
  try {
    var q = new URLSearchParams(location.search);
    var fromUrl = (q.get("src") || q.get("utm_source") || "").slice(0, 40);
    if (fromUrl) sessionStorage.setItem("src", fromUrl);
    source = sessionStorage.getItem("src") || (document.referrer ? new URL(document.referrer).hostname : "direct");
  } catch (e) {}
  var niche = form.dataset.niche;
  var btn = form.querySelector("button");
  var msg = document.getElementById("waitlistMsg");
  var configured = !!(S.formUrl && S.fields && S.fields.email);

  function show(text, kind) { msg.textContent = text; msg.className = "msg " + kind; msg.hidden = false; }

  var joined = null;
  try { joined = localStorage.getItem("waitlist:" + niche); } catch (e) {}
  if (joined) {
    form.hidden = true;
    show("You're on the list as " + joined + ". We'll email you when it opens.", "ok");
    return;
  }
  if (!configured) {
    btn.disabled = true;
    btn.textContent = "Waitlist opening soon";
    return;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = form.elements.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { show("Please enter a valid email address.", "err"); return; }
    var body = new URLSearchParams();
    body.append(S.fields.email, email);
    if (S.fields.niche) body.append(S.fields.niche, niche);
    if (S.fields.business) body.append(S.fields.business, form.elements.business.value);
    if (S.fields.source) body.append(S.fields.source, source);
    if (S.fields.name && form.elements.name.value.trim()) body.append(S.fields.name, form.elements.name.value.trim());
    btn.disabled = true;
    btn.textContent = "Joining…";
    // Google Forms doesn't send CORS headers, so the response can't be read; a
    // network failure still rejects, which is the case worth reporting.
    fetch(S.formUrl, { method: "POST", mode: "no-cors", body: body })
      .then(function () {
        try { localStorage.setItem("waitlist:" + niche, email); } catch (e2) {}
        form.hidden = true;
        show("You're on the list! We'll email " + email + " as soon as it opens.", "ok");
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = "Join the waitlist";
        show("Couldn't connect. Please check your internet and try again.", "err");
      });
  });
})();
