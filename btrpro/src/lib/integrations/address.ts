// Address suggestions for the address boxes. Google Places (if GOOGLE_MAPS_API_KEY is set) is best for US house
// addresses; otherwise Photon (free, OpenStreetMap). Both are biased toward Omaha. Called server-side only, so the
// key never reaches the browser.
const OMAHA = { lat: 41.2565, lon: -95.9345 };

export type Suggestion = { label: string };

type PhotonFeature = { properties: Record<string, string | undefined> };

const STATE_ABBR: Record<string, string> = { Nebraska: "NE", Iowa: "IA", Kansas: "KS", Missouri: "MO", "South Dakota": "SD", Colorado: "CO", Minnesota: "MN" };

/** One-line address from a Photon result. OSM often has the street but not the house, so the typed number is kept. */
export function photonLabel(f: PhotonFeature, query: string): string | null {
  const p = f.properties;
  if (p.countrycode && p.countrycode !== "US") return null;
  const typedNo = query.trim().match(/^(\d+[A-Za-z]?)\s/)?.[1];
  const street = p.street ?? (p.type === "street" ? p.name : null);
  const house = p.housenumber ?? (street && typedNo ? typedNo : null);
  const line1 = street ? [house, street].filter(Boolean).join(" ") : p.name;
  const state = p.state ? (STATE_ABBR[p.state] ?? p.state) : null;
  const city = p.city && !/precinct|township/i.test(p.city) ? p.city : null;
  const tail = [city, [state, p.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const s = [line1, tail].filter(Boolean).join(", ");
  return s || null;
}

export async function suggestAddresses(query: string, near = OMAHA): Promise<Suggestion[]> {
  const q = query.trim().slice(0, 200);
  if (q.length < 4) return [];
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (key) {
    const r = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
      body: JSON.stringify({
        input: q,
        includedRegionCodes: ["us"],
        locationBias: { circle: { center: { latitude: near.lat, longitude: near.lon }, radius: 50000 } },
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (r.ok) {
      const j = (await r.json()) as { suggestions?: { placePrediction?: { text?: { text?: string } } }[] };
      return (j.suggestions ?? [])
        .map((s) => s.placePrediction?.text?.text?.replace(/, USA$/, ""))
        .filter((s): s is string => !!s)
        .slice(0, 5)
        .map((label) => ({ label }));
    }
    console.error("places autocomplete failed", r.status);
  }
  // OSM rarely has house numbers here: search the metro area, then the street alone (keeping the typed number),
  // then anywhere.
  const typedNo = q.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  const tries: [string, boolean][] = [[q, true], ...(typedNo ? ([[typedNo[2], true]] as [string, boolean][]) : []), [q, false]];
  for (const [text, local] of tries) {
    const out = await photon(text, q, near, local);
    if (out.length) return out;
  }
  return [];
}

async function photon(text: string, typed: string, near: { lat: number; lon: number }, local: boolean): Promise<Suggestion[]> {
  const area = local ? `&bbox=${near.lon - 1.3},${near.lat - 0.9},${near.lon + 1.3},${near.lat + 0.8}` : `&lat=${near.lat}&lon=${near.lon}`;
  const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(text)}${area}&limit=8&lang=en`, {
    headers: { "User-Agent": "BTRpro (btrcontracting.com)" },
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) return [];
  const j = (await r.json()) as { features?: PhotonFeature[] };
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const f of j.features ?? []) {
    if (!["house", "street", "building"].includes(f.properties.type ?? "") && !f.properties.housenumber) continue;
    const label = photonLabel(f, typed);
    if (label && !seen.has(label)) {
      seen.add(label);
      out.push({ label });
    }
  }
  return out.slice(0, 5);
}

/** The address at a GPS point (rep standing at the house). Photon reverse; the house number may be missing in OSM. */
export async function addressAt(lat: number, lon: number): Promise<string | null> {
  const r = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=1&lang=en`, {
    headers: { "User-Agent": "BTRpro (btrcontracting.com)" },
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { features?: PhotonFeature[] };
  return j.features?.[0] ? photonLabel(j.features[0], "") : null;
}
