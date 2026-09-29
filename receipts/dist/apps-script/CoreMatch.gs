// Job matching: finds the job folder a receipt belongs to from a customer name
// and/or address, using the folder names exactly as they appear in Drive.

var ADDRESS_WORDS = {
  st: "street", str: "street", ave: "avenue", av: "avenue", dr: "drive", ln: "lane", rd: "road",
  blvd: "boulevard", ct: "court", cir: "circle", pl: "place", pkwy: "parkway", hwy: "highway",
  ter: "terrace", trl: "trail", cv: "cove", wy: "way",
  n: "north", s: "south", e: "east", w: "west", ne: "northeast", nw: "northwest", se: "southeast", sw: "southwest",
};
// Words that carry no identifying signal on their own.
var MATCH_STOPWORDS = { the: 1, and: 1, of: 1, lot: 1, llc: 1, inc: 1 };

function matchTokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/(\d+)(st|nd|rd|th)\b/g, "$1") // 164th -> 164
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(function (t) { return ADDRESS_WORDS[t] || t; })
    .filter(function (t) { return !MATCH_STOPWORDS[t]; });
}

// House numbers (3+ digits, or the first number in an address) are the strongest signal.
function houseNumbers(tokens) {
  return tokens.filter(function (t) { return /^\d{3,6}$/.test(t); });
}

/**
 * Score how well a hint ("Whitfield", "4410 Maple Ridge Dr") matches a job folder name.
 * Returns 0..1.
 */
function scoreJob(hint, jobName) {
  var h = matchTokens(hint), j = matchTokens(jobName);
  if (!h.length || !j.length) return 0;
  var jSet = {};
  j.forEach(function (t) { jSet[t] = true; });

  var hNums = houseNumbers(h), jNums = houseNumbers(j);
  var numScore = 0;
  if (hNums.length && jNums.length) {
    var shared = hNums.filter(function (n) { return jSet[n]; }).length;
    numScore = shared ? 1 : -1; // a different house number is strong evidence against
  }

  var words = h.filter(function (t) { return !/^\d+$/.test(t) && t.length > 1; });
  var wordHits = words.filter(function (t) { return jSet[t]; }).length;
  var wordScore = words.length ? wordHits / words.length : 0;

  var score;
  if (numScore === 1) score = 0.6 + 0.4 * wordScore;
  else if (numScore === -1) score = 0.15 * wordScore;
  else score = 0.85 * wordScore;
  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

/**
 * Match a receipt to a job.
 * hints: array of strings (customer name, address, job name from the email or receipt)
 * jobs:  array of job folder names (or {name, id} objects)
 * Returns { job, score, confident, candidates: [{job, score}] (top 5) }
 */
function matchJob(hints, jobs) {
  var list = (jobs || []).map(function (j) { return typeof j === "string" ? { name: j } : j; });
  var hintList = (hints || []).filter(function (x) { return x && String(x).trim(); });
  var combined = hintList.join(" ");
  var scored = list.map(function (job) {
    var best = scoreJob(combined, job.name);
    hintList.forEach(function (hint) { best = Math.max(best, scoreJob(hint, job.name)); });
    return { job: job, score: best };
  }).sort(function (a, b) { return b.score - a.score; });

  var top = scored[0], second = scored[1];
  var confident = !!top && top.score >= 0.6 && (!second || top.score - second.score >= 0.15);
  return {
    job: top && top.score > 0 ? top.job : null,
    score: top ? top.score : 0,
    confident: confident,
    candidates: scored.slice(0, 5).filter(function (c) { return c.score > 0; }),
  };
}
