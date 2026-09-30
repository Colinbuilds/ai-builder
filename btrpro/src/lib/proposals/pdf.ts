// Customer-facing proposal PDF (no cost breakdown). Includes the e-signature record once signed.
import type { Proposal } from "@prisma/client";
import { BTR } from "@/lib/company";
import { GREEN, PdfWriter } from "@/lib/pdf/writer";
import type { Alternate } from "./price";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export async function proposalPdf(p: Proposal) {
  const w = await PdfWriter.create({
    title: `${BTR.name} proposal ${p.number}`,
    footer: `${BTR.name} · ${BTR.phone} · Proposal ${p.number}`,
    header: (x) => x.text(`${BTR.name.toUpperCase()}  ·  ${BTR.address}  ·  ${BTR.phone}  ·  ${BTR.email}`, { size: 7, gap: 6 }),
  });
  w.text(`Proposal ${p.number}`, { size: 18, bold: true, gap: 2 });
  w.text(p.title, { size: 12, gap: 2 });
  w.text(
    [p.recipientName && `Prepared for ${p.recipientName}`, `Date ${p.createdAt.toLocaleDateString("en-US")}`, p.validUntil && `Valid until ${p.validUntil.toLocaleDateString("en-US")}`]
      .filter(Boolean)
      .join("  ·  "),
    { size: 9, gap: 8 },
  );
  const scope = p.scope as { weWill: string[]; weWillNot: string[] };
  w.heading("Scope of work — We Will");
  for (const s of scope.weWill) w.text(`• ${s}`, { size: 10, gap: 0 });
  if (!scope.weWill.length) w.text("—", { size: 10 });
  w.y -= 4;
  w.heading("Not included — We Will Not");
  for (const s of scope.weWillNot) w.text(`• ${s}`, { size: 10, gap: 0 });
  if (!scope.weWillNot.length) w.text("—", { size: 10 });
  w.y -= 4;
  w.heading("Price");
  const alts = (p.alternates as Alternate[] | null) ?? [];
  const sel = (p.selectedAlternates as string[] | null) ?? [];
  const rows: string[][] = [["Base price", usd(p.basePrice)]];
  for (const a of alts) rows.push([`Option: ${a.name}${a.description ? ` — ${a.description}` : ""}${p.status === "SIGNED" ? (sel.includes(a.name) ? " (accepted)" : " (not selected)") : ""}`, `+ ${usd(a.price)}`]);
  if (p.status === "SIGNED" && p.acceptedTotal != null) rows.push(["Accepted total", usd(p.acceptedTotal)]);
  if (p.depositPct) rows.push([`Deposit due at signing (${p.depositPct}%)`, usd(((p.acceptedTotal ?? p.basePrice) * p.depositPct) / 100)]);
  w.table(
    [
      { header: "", width: 75 },
      { header: "", width: 25, align: "right" },
    ],
    rows,
    { size: 10 },
  );
  w.heading("Terms");
  w.text(p.terms, { size: 8 });
  w.heading("Acceptance");
  if (p.status === "SIGNED" && p.signedAt) {
    if (p.signatureImage) {
      const png = await w.doc.embedPng(Buffer.from(p.signatureImage.split(",")[1], "base64"));
      const h = 50;
      const width = (png.width / png.height) * h;
      w.ensure(h + 10);
      w.page.drawImage(png, { x: w.margin, y: w.y - h, width: Math.min(width, 250), height: h });
      w.y -= h + 4;
    }
    w.text(`Signed electronically by ${p.signerName} (${p.signerEmail})`, { size: 10, bold: true, color: GREEN, gap: 0 });
    w.text(`${p.signedAt.toISOString()} · IP ${p.signerIp ?? "unknown"} · ${p.signerAgent ?? ""}`, { size: 7, gap: 0 });
    w.text("The signer agreed to sign electronically and that this signature is legally binding.", { size: 7 });
  } else {
    w.text("Sign online at the link in your email.", { size: 9 });
  }
  return w.save();
}
