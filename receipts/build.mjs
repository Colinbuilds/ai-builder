// Builds the Apps Script project in dist/apps-script/ from the shared sources:
//   core/*.js      -> Core*.gs (server) and CoreClient.html (browser)
//   ui/app.js/.css -> UiScript.html / UiStyles.html
//   apps-script/*  -> copied as-is
// and the public test drive page ../try/index.html from try.html (served by GitHub Pages).
// Usage: node build.mjs          (write)   node build.mjs --check  (fail if dist is stale)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from "node:fs";

const root = new URL("./", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const CORE = ["pricing", "match", "documents", "quickbooks", "extract"];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

function outputs() {
  const files = {};
  for (const name of CORE) files[`Core${cap(name)}.gs`] = read(`core/${name}.js`);
  files["CoreClient.html"] = CORE.map((n) => `<script>\n${read(`core/${n}.js`)}\n</script>`).join("\n") + "\n";
  files["UiScript.html"] = `<script>\n${read("ui/app.js")}\n</script>\n`;
  files["UiStyles.html"] = `<style>\n${read("ui/app.css")}\n</style>\n`;
  for (const f of readdirSync(new URL("apps-script/", root))) files[f] = read(`apps-script/${f}`);
  return files;
}

// try.html is written for the artifact viewer (no document skeleton, paths relative to receipts/).
function testDrivePage() {
  let page = read("try.html");
  const title = page.match(/<title>([^<]*)<\/title>/)[1];
  page = page.replace(/<title>[^<]*<\/title>\n?/, "").replace(/(src|href)="(ui|core|demo)\//g, '$1="../receipts/$2/');
  const brand = "<b>Test drive</b>";
  if (!page.includes(brand)) throw new Error("try.html: test drive label not found");
  page = page.replace(brand, '<b><a href="../" style="color:inherit">JobReceipts</a> · Test drive</b>');
  return `<!doctype html>
<!-- Generated from receipts/try.html by receipts/build.mjs. Edit that file, then run: node build.mjs -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="Try JobReceipts with sample receipts: send one from an employee's phone, then price and approve it as a change order or invoice from the office view.">
<style>body { margin: 0; }</style>
</head>
<body>
${page}</body>
</html>
`;
}

const out = new URL("dist/apps-script/", root);
const files = outputs();
const tryOut = new URL("../try/index.html", root);
const tryPage = testDrivePage();
if (process.argv.includes("--check")) {
  if (!existsSync(tryOut) || readFileSync(tryOut, "utf8") !== tryPage) { console.error("try/index.html is out of date. Run: node build.mjs"); process.exit(1); }
  const stale = Object.entries(files).filter(([n, c]) => !existsSync(new URL(n, out)) || readFileSync(new URL(n, out), "utf8") !== c);
  const extra = existsSync(out) ? readdirSync(out).filter((n) => !(n in files)) : [];
  if (stale.length || extra.length) { console.error("dist/apps-script is out of date:", [...stale.map((s) => s[0]), ...extra].join(", "), "\nRun: node build.mjs"); process.exit(1); }
  console.log("dist/apps-script is up to date");
} else {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const [n, c] of Object.entries(files)) writeFileSync(new URL(n, out), c);
  console.log("wrote", Object.keys(files).length, "files to dist/apps-script/");
  mkdirSync(new URL("../try/", root), { recursive: true });
  writeFileSync(tryOut, tryPage);
  console.log("wrote ../try/index.html");
}
