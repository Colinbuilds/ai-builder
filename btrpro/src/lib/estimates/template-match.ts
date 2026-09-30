// Suggests estimate templates from the products a plan set or spec names. Plain string matching, no AI:
// the brief says what the documents specify; this only points at the template that uses those products.
// A suggestion is a starting point — the estimator still checks every product against the spec.

export type MatchTemplate = {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  group: string;
  impactClass: string | null;
};
export type SpecProduct = {
  category: string;
  description: string;
  product: string | null;
  orEqual: boolean;
  page: number;
  quote: string;
};
export type TemplateSuggestion = {
  templateId: string;
  name: string;
  strength: "EXACT" | "BRAND" | "TYPE";
  reason: string;
  page: number;
  warning: string | null;
};

const BRAND_ALIASES: Record<string, string[]> = {
  gaf: ["gaf"],
  "owens corning": [
    "owens corning",
    "owens-corning",
    "oc duration",
    "trudefinition",
  ],
  certainteed: ["certainteed", "certain teed"],
  malarkey: ["malarkey"],
  iko: ["iko"],
  tamko: ["tamko"],
  atlas: ["atlas"],
  mulehide: ["mulehide", "mule-hide", "mule hide"],
  elevate: ["elevate", "firestone"],
  "james hardie": [
    "james hardie",
    "hardie",
    "hardieplank",
    "hardiepanel",
    "hardietrim",
  ],
  lp: [
    "lp smartside",
    "smartside",
    "louisiana-pacific",
    "louisiana pacific",
    "lp ",
  ],
  norandex: ["norandex", "ndx"],
};

const GENERIC = new Set([
  "the",
  "and",
  "or",
  "equal",
  "approved",
  "with",
  "for",
  "lap",
  "siding",
  "shingle",
  "shingles",
  "roofing",
  "system",
  "series",
  "primed",
  "designer",
  "fully",
  "mechanically",
  "attached",
  "adhered",
  "pre-secured",
]);

export const norm = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/(\d{2})\s*-?\s*mil\b/g, "0$1") // "60 mil" → "060"
    .replace(/\.0(\d{2})\b/g, "0$1") // ".060" → "060"
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

function brandKey(brand: string | null, name: string): string | null {
  const b = norm(`${brand ?? ""} ${name}`);
  for (const [k, aliases] of Object.entries(BRAND_ALIASES))
    if (aliases.some((a) => b.includes(norm(a)))) return k;
  return null;
}

function nameTokens(t: MatchTemplate): string[] {
  const brandWords = new Set(
    norm(t.brand ?? "")
      .trim()
      .split(" "),
  );
  return norm(t.name)
    .trim()
    .split(" ")
    .filter(
      (w) =>
        /^0\d{2}$/.test(w) ||
        (w.length > 1 &&
          !brandWords.has(w) &&
          !GENERIC.has(w) &&
          !/^\d+$/.test(w)),
    );
}

// Which template categories a spec item can land in, and generic type words that pick a group.
const CAT_FOR: Record<string, string[]> = {
  ROOF_COVERING: ["SHINGLE", "FLAT"],
  WALL_CLADDING: ["SIDING"],
  SOFFIT_FASCIA: ["SIDING"],
  TRIM: ["SIDING"],
};
const TYPE_WORDS: [RegExp, (t: MatchTemplate) => boolean][] = [
  [/\btpo\b|thermoplastic polyolefin/, (t) => /tpo/i.test(t.group)],
  [/\bepdm\b|ethylene propylene/, (t) => /epdm/i.test(t.group)],
  [/fiber[ -]?cement/, (t) => /hardie/i.test(t.group)],
  [/engineered (wood|treated wood)|smartside/, (t) => /\blp\b/i.test(t.group)],
  [/\bvinyl\b|\bpvc siding/, (t) => /vinyl/i.test(t.group)],
];

const isClass4 = (s: string) => /class\s*4|ul\s*2218|impact[- ]resist/i.test(s);

/** Ranked template suggestions for the specified products. */
export function suggestTemplates(
  products: SpecProduct[],
  templates: MatchTemplate[],
  opts: { impactRequirement?: string | null } = {},
): TemplateSuggestion[] {
  const out = new Map<string, TemplateSuggestion>();
  const rank = { EXACT: 3, BRAND: 2, TYPE: 1 } as const;
  const needC4 = !!opts.impactRequirement && isClass4(opts.impactRequirement);
  const add = (s: TemplateSuggestion) => {
    const prev = out.get(s.templateId);
    if (!prev || rank[s.strength] > rank[prev.strength])
      out.set(s.templateId, s);
  };
  for (const p of products) {
    const cats = CAT_FOR[p.category];
    if (!cats) continue;
    const text = `${p.product ?? ""} ${p.description}`;
    const n = norm(text);
    const pool = templates.filter((t) => cats.includes(t.category));
    const specBrand = brandKey(null, text);
    const c4Spec = p.category === "ROOF_COVERING" && (needC4 || isClass4(text)); // impact ratings are a roof-covering requirement
    const c4Warn = (t: MatchTemplate) =>
      c4Spec && t.impactClass !== "CLASS_4"
        ? "Spec calls for Class 4 / impact-resistant; this template isn't confirmed Class 4."
        : null;
    let exact = false;
    if (specBrand) {
      const same = pool.filter((t) => brandKey(t.brand, t.name) === specBrand);
      const scored = same
        .map((t) => {
          const toks = nameTokens(t);
          const hit = toks.filter((w) => n.includes(` ${w} `)).length;
          return { t, hit, of: toks.length };
        })
        .filter((x) => x.hit > 0)
        .sort((a, b) => b.hit / b.of - a.hit / a.of || b.hit - a.hit);
      const best = scored[0];
      if (best && best.hit === best.of) {
        for (const x of scored.filter((x) => x.hit === x.of)) {
          exact = true;
          add({
            templateId: x.t.id,
            name: x.t.name,
            strength: "EXACT",
            reason: `Specified on p.${p.page}: "${p.quote.slice(0, 140)}"`,
            page: p.page,
            warning: c4Warn(x.t),
          });
        }
      } else if (best) {
        add({
          templateId: best.t.id,
          name: best.t.name,
          strength: "BRAND",
          reason: `Closest ${best.t.brand} template to "${(p.product ?? p.description).slice(0, 100)}" (p.${p.page}). Check the product line.`,
          page: p.page,
          warning: c4Warn(best.t),
        });
      } else if (same.length) {
        for (const t of same
          .filter((t) => !c4Spec || t.impactClass === "CLASS_4")
          .slice(0, 3))
          add({
            templateId: t.id,
            name: t.name,
            strength: "BRAND",
            reason: `Same brand as specified on p.${p.page}; the exact product line has no template yet.`,
            page: p.page,
            warning: c4Warn(t),
          });
      }
    }
    // Spec needs Class 4 but allows an equal: offer the confirmed Class 4 shingle templates too.
    if (c4Spec && p.orEqual)
      for (const t of pool.filter((t) => t.category === "SHINGLE" && t.impactClass === "CLASS_4"))
        add({ templateId: t.id, name: t.name, strength: "TYPE", reason: `Class 4 option — spec allows an equal (p.${p.page}).`, page: p.page, warning: null });
    if (exact) continue;
    // No brand match: fall back to the material type the spec describes (TPO, EPDM, fiber cement, vinyl…).
    if (!specBrand || p.orEqual) {
      for (const [re, fits] of TYPE_WORDS) {
        if (!re.test(n)) continue;
        for (const t of pool.filter(fits))
          add({
            templateId: t.id,
            name: t.name,
            strength: "TYPE",
            reason: `${p.orEqual ? "Spec allows an equal" : "Material type matches"}: "${(p.product ?? p.description).slice(0, 100)}" (p.${p.page}).`,
            page: p.page,
            warning: c4Warn(t),
          });
      }
    }
  }
  return [...out.values()].sort(
    (a, b) =>
      rank[b.strength] - rank[a.strength] ||
      (a.warning ? 1 : 0) - (b.warning ? 1 : 0) ||
      a.page - b.page,
  );
}
