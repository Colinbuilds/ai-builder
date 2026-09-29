// First-pass document type from the file name and the first pages' text. The user can always change it.
export type DocType = "EAGLEVIEW" | "PLANS" | "SPECS" | "MFR_DATA" | "SUB_PROPOSAL" | "CHANGE_ORDER" | "PHOTO" | "OTHER";

export function guessDocType(fileName: string, text: string, contentType?: string | null): DocType {
  const name = fileName.toLowerCase();
  const t = text.slice(0, 20000).toLowerCase();
  if (contentType?.startsWith("image/") || /\.(jpe?g|png|heic|webp|gif)$/.test(name)) return "PHOTO";
  if (/eagleview/.test(name) || /eagleview|premium report|walls report|report summary.*pitch/.test(t)) return "EAGLEVIEW";
  if (/change order|\bco[ -]?#?\d|pco\b|cor\b/.test(name) || /change order (request|no\.|number)|potential change order/.test(t)) return "CHANGE_ORDER";
  if (/proposal|quote|bid form/.test(name) && !/request/.test(name)) return "SUB_PROPOSAL";
  if (/spec|project manual/.test(name) || /section 07\s?\d{2}|division 07|part 1 ?- ?general/.test(t)) return "SPECS";
  if (/product data|data sheet|installation (guide|instructions)|technical data/.test(t) || /pds|tds|data ?sheet/.test(name)) return "MFR_DATA";
  if (/plan|drawing|sheet|dwg|\b[asm]-?\d{3}\b/.test(name) || /roof plan|floor plan|elevation|sheet index|scale:/.test(t)) return "PLANS";
  return "OTHER";
}
