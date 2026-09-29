// Renders one landing page per industry: site/<slug>/index.html
// Usage: node niches/build.mjs          (write pages)
//        node niches/build.mjs --check  (exit 1 if any page is out of date)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { NICHES } from "./niches.mjs";

const SITE_URL = "https://colinbuilds.github.io/ai-builder/site/";
const siteDir = new URL("../site/", import.meta.url);

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderPage(n) {
  const others = NICHES.filter((o) => o.slug !== n.slug)
    .map((o) => `<a href="../${o.slug}/">${esc(o.brand)} <span>· ${esc(o.industry)}</span></a>`).join("\n        ");
  const tools = n.tools.map(([name, desc]) =>
    `<div class="card"><span class="soon">Coming soon</span><h3>${esc(name)}</h3><p>${esc(desc)}</p></div>`).join("\n      ");
  const pains = n.pains.map((p) => `<li>${esc(p)}</li>`).join("\n      ");
  const faq = n.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n    ");
  const options = n.businesses.map((b) => `<option>${esc(b)}</option>`).join("");
  const url = SITE_URL + n.slug + "/";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(n.title)}</title>
<meta name="description" content="${esc(n.description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(n.title)}">
<meta property="og:description" content="${esc(n.description)}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='%234F46E5'/><text x='50' y='68' font-size='52' text-anchor='middle' fill='white' font-family='Arial' font-weight='bold'>${esc(n.brand[0])}</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../assets/niche.css">
</head>
<body>
<div class="wrap">
  <nav>
    <a class="logo" href="./"><i>${esc(n.brand[0])}</i>${esc(n.brand)}</a>
    <a class="btn small" href="#join">Get early access</a>
  </nav>

  <header class="hero">
    <div>
      <span class="eyebrow">${esc(n.eyebrow)}</span>
      <h1>${esc(n.headline)}<em>${esc(n.highlight)}</em></h1>
      <p class="lead">${esc(n.sub)}</p>
      <div class="cta-row">
        <a class="btn" href="#join">Join the waitlist</a>
        <a class="btn ghost" href="#calculator">Try the free calculator</a>
      </div>
      <p class="trust">Free calculator · No sign-up needed · Built for ${esc(n.audience)}</p>
    </div>
    <div class="calc-card" id="calculator">
      <h2 id="calcTitle"></h2>
      <p class="intro">${esc(n.calcIntro)}</p>
      <div id="calc" data-calc="${esc(n.calc)}"></div>
    </div>
  </header>
</div>

<section class="alt">
  <div class="wrap">
    <h2>Sound familiar?</h2>
    <p class="sub">You're great at the work. It's everything around it that eats your week.</p>
    <ul class="pains">
      ${pains}
    </ul>
  </div>
</section>

<section>
  <div class="wrap">
    <h2>What ${esc(n.brand)} will do for you</h2>
    <p class="sub">Four AI tools built for ${esc(n.audience)}. Answer a few questions, get finished work, saved to your Google Drive.</p>
    <div class="grid">
      ${tools}
    </div>
  </div>
</section>

<section class="alt">
  <div class="wrap">
    <h2>How it works</h2>
    <p class="sub">No prompts to write and nothing new to learn.</p>
    <div class="grid steps">
      <div class="card"><h3>Pick a tool</h3><p>Choose what you need done: a quote, a follow-up, a post, a reply.</p></div>
      <div class="card"><h3>Answer a few questions</h3><p>Plain-English questions about the job or the customer. Paste in notes if you have them.</p></div>
      <div class="card"><h3>Use it right away</h3><p>Copy it, send it, or save it to Google Sheets in one click. Edit anything you like.</p></div>
    </div>
  </div>
</section>

<section id="join">
  <div class="wrap">
    <div class="join">
      <h2>Get early access</h2>
      <p class="price">Planned price <strong>$${n.price}/month</strong>. Waitlist members get first access and a founding-member discount.</p>
      <form id="waitlist" data-niche="${esc(n.slug)}" novalidate>
        <label>Email<input type="email" name="email" autocomplete="email" required placeholder="you@business.com"></label>
        <label>Your business<select name="business">${options}</select></label>
        <label>First name <span style="font-weight:400;color:var(--muted)">(optional)</span><input type="text" name="name" autocomplete="given-name"></label>
        <button class="btn" type="submit">Join the waitlist</button>
        <p class="fine">No spam. One email when it opens. Unsubscribe anytime.</p>
      </form>
      <div class="msg" id="waitlistMsg" role="status" hidden></div>
    </div>
  </div>
</section>

<section class="alt">
  <div class="wrap">
    <h2>Questions</h2>
    <p class="sub"></p>
    ${faq}
  </div>
</section>

<footer>
  <div class="wrap">
    <div>Also for other industries:</div>
    <div class="others">
        ${others}
    </div>
    <div class="row">
      <span>© <span id="year"></span> ${esc(n.brand)}</span>
      <span><a href="../terms.html">Terms</a> · <a href="../privacy.html">Privacy</a></span>
    </div>
  </div>
</footer>

<script src="../config.js"></script>
<script src="../assets/calculators.js"></script>
<script src="../assets/waitlist.js"></script>
<script>
  document.getElementById("year").textContent = new Date().getFullYear();
  var box = document.getElementById("calc");
  document.getElementById("calcTitle").textContent = Calculators.CALCS[box.dataset.calc].title;
  Calculators.render(box, box.dataset.calc);
</script>
</body>
</html>
`;
}

function outputs() {
  const files = NICHES.map((n) => [new URL(`${n.slug}/index.html`, siteDir), renderPage(n)]);
  return files;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const [file, html] of outputs()) {
    if (check) {
      if (!existsSync(file) || readFileSync(file, "utf8") !== html) { console.error("out of date:", file.pathname); stale++; }
      continue;
    }
    mkdirSync(new URL("./", file), { recursive: true });
    writeFileSync(file, html);
    console.log("wrote", file.pathname.replace(/.*\/ai-builder\//, ""));
  }
  if (stale) { console.error("Run: node niches/build.mjs"); process.exit(1); }
}
