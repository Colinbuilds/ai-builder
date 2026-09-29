// Turns an uploaded price-sheet file into text (CLAUDE.md §5 file format note).
// Some BTR "PDFs" are really ZIP containers of .txt files, so check the magic bytes first.
import JSZip from "jszip";

export type SheetFormat = "ZIP_TXT" | "PDF" | "CSV" | "TEXT";

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const isPdf = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF

export async function extractSheetText(bytes: Uint8Array, fileName: string): Promise<{ format: SheetFormat; text: string }> {
  if (isZip(bytes)) {
    const zip = await JSZip.loadAsync(bytes);
    const txt = Object.values(zip.files)
      .filter((f) => !f.dir && f.name.toLowerCase().endsWith(".txt"))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!txt.length) throw new Error("This file is a ZIP container but has no .txt files inside.");
    const parts = await Promise.all(txt.map((f) => f.async("string")));
    return { format: "ZIP_TXT", text: parts.join("\n") };
  }
  if (isPdf(bytes)) return { format: "PDF", text: await pdfToText(bytes) };
  const text = new TextDecoder().decode(bytes);
  return { format: fileName.toLowerCase().endsWith(".csv") ? "CSV" : "TEXT", text };
}

/** Rebuilds text lines from PDF glyph positions (items on the same baseline form one line). */
export async function pdfToText(bytes: Uint8Array): Promise<string> {
  return (await pdfPages(bytes)).join("\n");
}

/** Text of each page, in order (index 0 = page 1). */
export async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const out: string[] = [];
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const lines: { y: number; parts: { x: number; s: string }[] }[] = [];
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      let line = lines.find((l) => Math.abs(l.y - y) < 2.5);
      if (!line) lines.push((line = { y, parts: [] }));
      line.parts.push({ x, s: it.str });
    }
    lines.sort((a, b) => b.y - a.y);
    for (const l of lines) out.push(l.parts.sort((a, b) => a.x - b.x).map((q) => q.s.trim()).join(" "));
    pages.push(out.join("\n"));
  }
  await task.destroy();
  return pages;
}
