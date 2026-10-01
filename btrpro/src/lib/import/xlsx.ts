// Minimal .xlsx / .csv reader for job-schedule imports: every tab as a grid of cell text.
// Numbers come back as their stored value ("4869.12"); the schedule parser handles money and dates.
import JSZip from "jszip";

// links: cell hyperlinks keyed "row,col" (0-based), e.g. a "Folder" cell that links to a Drive folder
export type Tab = { name: string; rows: string[][]; links?: Record<string, string> };

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&amp;/g, "&");
const texts = (xml: string) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((m) => decode(m[1]))
    .join("");
const colIndex = (ref: string) => {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

export async function readXlsx(bytes: Uint8Array): Promise<Tab[]> {
  const zip = await JSZip.loadAsync(bytes);
  const file = async (p: string) =>
    (await zip.file(p)?.async("string")) ?? null;
  const wb = await file("xl/workbook.xml");
  if (!wb) throw new Error("That file isn't an Excel workbook (.xlsx).");
  const rels = (await file("xl/_rels/workbook.xml.rels")) ?? "";
  const target = new Map(
    [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      m[0].match(/Id="([^"]+)"/)?.[1],
      m[0].match(/Target="([^"]+)"/)?.[1],
    ]),
  );
  const shared = [
    ...((await file("xl/sharedStrings.xml")) ?? "").matchAll(
      /<si>([\s\S]*?)<\/si>/g,
    ),
  ].map((m) => texts(m[1]));
  const tabs: Tab[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decode(m[0].match(/name="([^"]*)"/)?.[1] ?? "");
    const rid = m[0].match(/r:id="([^"]+)"/)?.[1];
    let t = target.get(rid) ?? "";
    t = t.startsWith("/") ? t.slice(1) : `xl/${t}`;
    const xml = await file(t);
    if (!xml) continue;
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const rn = Number(r[1].match(/\br="(\d+)"/)?.[1] ?? rows.length + 1) - 1;
      const row: string[] = [];
      for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const body = c[2] ?? "";
        const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
        const type = attrs.match(/\bt="([^"]+)"/)?.[1];
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let val = "";
        if (type === "s") val = shared[Number(v)] ?? "";
        else if (type === "inlineStr") val = texts(body);
        else if (type === "b") val = v === "1" ? "TRUE" : "FALSE";
        else val = v != null ? decode(v) : "";
        row[ref ? colIndex(ref) : row.length] = val;
      }
      rows[rn] = Array.from(row, (x) => x ?? "");
    }
    const links: Record<string, string> = {};
    const hl = [...xml.matchAll(/<hyperlink\b[^>]*>/g)];
    if (hl.length) {
      const relPath = t.replace(/([^/]+)$/, "_rels/$1.rels");
      const sheetRels = (await file(relPath)) ?? "";
      const relTarget = new Map(
        [...sheetRels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [m[0].match(/Id="([^"]+)"/)?.[1], decode(m[0].match(/Target="([^"]+)"/)?.[1] ?? "")]),
      );
      for (const h of hl) {
        const ref = h[0].match(/\bref="([A-Z]+)(\d+)"/);
        const url = relTarget.get(h[0].match(/r:id="([^"]+)"/)?.[1]);
        if (ref && url && /^https?:/i.test(url)) links[`${Number(ref[2]) - 1},${colIndex(ref[1])}`] = url;
      }
    }
    tabs.push({ name, rows: Array.from(rows, (x) => x ?? []), links });
  }
  return tabs;
}

/** RFC 4180 CSV → one tab. */
export function readCsv(text: string, name = "Sheet1"): Tab {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') ((cell += '"'), i++);
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") (row.push(cell), (cell = ""));
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      (row.push(cell), rows.push(row), (row = []), (cell = ""));
    } else cell += ch;
  }
  if (cell || row.length) (row.push(cell), rows.push(row));
  return { name, rows };
}
