// Which documents can be measured: PDFs and browser-viewable images (by name or stored content type).
export function sheetKind(fileName: string, contentType?: string | null): "pdf" | "image" | null {
  if (/\.pdf$/i.test(fileName) || contentType === "application/pdf") return "pdf";
  if (/\.(png|jpe?g|webp)$/i.test(fileName) || /^image\/(png|jpe?g|webp)$/i.test(contentType ?? "")) return "image";
  return null;
}
