import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

// Serves the PDF renderer to the browser (plan takeoff) straight from the installed package (the legacy build,
// which carries polyfills for browsers a few versions old), so it never
// goes through the bundler and the main script and its worker always match.
const FILES = new Set(["pdf.min.mjs", "pdf.worker.min.mjs"]);

export async function GET(_: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!FILES.has(file)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await readFile(path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", file));
  return new NextResponse(new Uint8Array(body), {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=604800, immutable" },
  });
}
