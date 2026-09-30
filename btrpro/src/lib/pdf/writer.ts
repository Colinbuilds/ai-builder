// Small PDF layout helper on pdf-lib: wrapped text, tables that break across pages, header/footer.
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, type RGB } from "pdf-lib";

// Standard PDF fonts only encode WinAnsi (CP1252). Map common symbols; drop anything else.
const MAP: Record<string, string> = { "→": "->", "←": "<-", "≤": "<=", "≥": ">=", "✔": "OK", "✖": "X", "ℹ": "i", "☐": "[ ]", "☑": "[x]", " ": " " };
const CP1252_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
export function safe(s: string) {
  return s
    .replace(/[→←≤≥✔✖ℹ☐☑ ]/g, (c) => MAP[c])
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/gu, (c) => (CP1252_EXTRA.includes(c) ? c : "?"));
}

export type Col = { header: string; width: number; align?: "left" | "right" };

export class PdfWriter {
  doc!: PDFDocument;
  font!: PDFFont;
  bold!: PDFFont;
  page!: PDFPage;
  y = 0;
  readonly margin = 40;
  readonly width = 612;
  readonly height = 792;
  private footer = "";
  private header: ((w: PdfWriter) => void) | null = null;

  static async create(opts: { title: string; footer: string; header?: (w: PdfWriter) => void }) {
    const w = new PdfWriter();
    w.doc = await PDFDocument.create();
    w.doc.setTitle(safe(opts.title));
    w.doc.setProducer("BTRpro");
    w.font = await w.doc.embedFont(StandardFonts.Helvetica);
    w.bold = await w.doc.embedFont(StandardFonts.HelveticaBold);
    w.footer = opts.footer;
    w.header = opts.header ?? null;
    w.newPage();
    return w;
  }

  get contentWidth() {
    return this.width - this.margin * 2;
  }

  newPage() {
    this.page = this.doc.addPage([this.width, this.height]);
    this.y = this.height - this.margin;
    this.header?.(this);
  }

  ensure(h: number) {
    if (this.y - h < this.margin + 24) this.newPage();
  }

  wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const out: string[] = [];
    for (const para of safe(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const tryLine = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(tryLine, size) <= maxWidth) line = tryLine;
        else {
          if (line) out.push(line);
          // hard-break very long words
          let w = word;
          while (font.widthOfTextAtSize(w, size) > maxWidth && w.length > 1) {
            let n = w.length;
            while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > maxWidth) n--;
            out.push(w.slice(0, n));
            w = w.slice(n);
          }
          line = w;
        }
      }
      out.push(line);
    }
    return out;
  }

  text(t: string, opts: { size?: number; bold?: boolean; color?: RGB; x?: number; maxWidth?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const x = opts.x ?? this.margin;
    const lines = this.wrap(t, font, size, opts.maxWidth ?? this.contentWidth - (x - this.margin));
    for (const l of lines) {
      this.ensure(size + 3);
      this.page.drawText(l, { x, y: this.y - size, size, font, color: opts.color ?? rgb(0.1, 0.1, 0.12) });
      this.y -= size + 3;
    }
    this.y -= opts.gap ?? 2;
  }

  heading(t: string) {
    this.ensure(30);
    this.y -= 6;
    this.text(t, { size: 12, bold: true, gap: 4 });
    this.page.drawLine({ start: { x: this.margin, y: this.y + 2 }, end: { x: this.width - this.margin, y: this.y + 2 }, thickness: 0.5, color: rgb(0.75, 0.75, 0.78) });
    this.y -= 4;
  }

  table(cols: Col[], rows: string[][], opts: { size?: number; shade?: (i: number) => RGB | null } = {}) {
    const size = opts.size ?? 8;
    const total = cols.reduce((a, c) => a + c.width, 0);
    const widths = cols.map((c) => (c.width / total) * this.contentWidth);
    const drawRow = (cells: string[], font: PDFFont, bg: RGB | null) => {
      const wrapped = cells.map((c, i) => this.wrap(c ?? "", font, size, widths[i] - 6));
      const h = Math.max(...wrapped.map((w) => w.length)) * (size + 2) + 4;
      this.ensure(h);
      if (bg) this.page.drawRectangle({ x: this.margin, y: this.y - h, width: this.contentWidth, height: h, color: bg });
      let x = this.margin;
      wrapped.forEach((lines, i) => {
        lines.forEach((l, j) => {
          const tw = font.widthOfTextAtSize(l, size);
          const tx = cols[i].align === "right" ? x + widths[i] - 3 - tw : x + 3;
          this.page.drawText(l, { x: tx, y: this.y - 2 - size - j * (size + 2), size, font, color: rgb(0.1, 0.1, 0.12) });
        });
        x += widths[i];
      });
      this.y -= h;
      return h;
    };
    const header = () => drawRow(cols.map((c) => c.header), this.bold, rgb(0.92, 0.93, 0.95));
    header();
    rows.forEach((r, i) => {
      const before = this.page;
      const cells = r.map((c) => c ?? "");
      const needed = Math.max(...cells.map((c, k) => this.wrap(c, this.font, size, widths[k] - 6).length)) * (size + 2) + 4;
      this.ensure(needed);
      if (this.page !== before) header();
      drawRow(cells, this.font, opts.shade?.(i) ?? null);
    });
    this.y -= 6;
  }

  stamp(text: string, color: RGB) {
    const size = 14;
    const w = this.bold.widthOfTextAtSize(safe(text), size) + 16;
    this.ensure(30);
    this.page.drawRectangle({ x: this.width - this.margin - w, y: this.y - 24, width: w, height: 22, borderColor: color, borderWidth: 2 });
    this.page.drawText(safe(text), { x: this.width - this.margin - w + 8, y: this.y - 18, size, font: this.bold, color });
    this.y -= 30;
  }

  async save() {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      p.drawText(safe(`${this.footer} · Page ${i + 1} of ${pages.length}`), { x: this.margin, y: 22, size: 7, font: this.font, color: rgb(0.45, 0.45, 0.5) });
    });
    return this.doc.save();
  }
}

export const RED = rgb(0.75, 0.1, 0.1);
export const AMBER = rgb(0.7, 0.45, 0.05);
export const GREEN = rgb(0.1, 0.5, 0.2);
export const GREY = rgb(0.4, 0.4, 0.45);
