"""Build every deliverable for the AI Solo Business Kit.

    python3 product/build.py

Outputs to dist/:
    starter/  complete/  pro/        unpacked tier folders
    *.zip                            one download per tier (upload these to your checkout platform)
"""

import shutil
import sys
import zipfile
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table,
                                TableStyle)

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from content import playbook as pb  # noqa: E402
from content.prompts import CATEGORIES, CONTEXT_BLOCK, count  # noqa: E402
import sheets  # noqa: E402

DIST = ROOT.parent / "dist"
BRAND = colors.HexColor("#4F46E5")
MUTED = colors.HexColor("#6B7280")
SOFT = colors.HexColor("#EEF2FF")

SLUG = "ai-solo-business-kit"

ss = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=ss["Heading1"], textColor=BRAND, fontSize=22, spaceAfter=10)
H2 = ParagraphStyle("H2", parent=ss["Heading2"], textColor=BRAND, fontSize=15, spaceBefore=6, spaceAfter=6)
BODY = ParagraphStyle("Body", parent=ss["BodyText"], fontSize=10.5, leading=15)
SMALL = ParagraphStyle("Small", parent=BODY, fontSize=9, textColor=MUTED)
PTITLE = ParagraphStyle("PTitle", parent=BODY, fontName="Helvetica-Bold", fontSize=11, spaceBefore=8)
PBOX = ParagraphStyle("PBox", parent=BODY, fontName="Courier", fontSize=9.5, leading=13.5)
COVER_T = ParagraphStyle("CoverT", parent=H1, fontSize=34, leading=40, alignment=TA_CENTER)
COVER_S = ParagraphStyle("CoverS", parent=BODY, fontSize=14, leading=20, alignment=TA_CENTER, textColor=MUTED)


def boxed(text, style=PBOX):
    t = Table([[Paragraph(text, style)]], colWidths=[6.5 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SOFT),
        ("BOX", (0, 0), (-1, -1), 0.5, BRAND),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(inch, 0.6 * inch, f"{pb.PRODUCT_NAME}  ·  v{pb.VERSION}")
    canvas.drawRightString(LETTER[0] - inch, 0.6 * inch, str(doc.page))
    canvas.restoreState()


def build_pdf(path, include_playbook=True):
    doc = SimpleDocTemplate(str(path), pagesize=LETTER, leftMargin=inch, rightMargin=inch,
                            topMargin=0.9 * inch, bottomMargin=0.9 * inch,
                            title=pb.PRODUCT_NAME, author=pb.PRODUCT_NAME)
    s = [Spacer(1, 2 * inch), Paragraph(pb.PRODUCT_NAME, COVER_T), Spacer(1, 12),
         Paragraph(pb.TAGLINE, COVER_S), Spacer(1, 30),
         Paragraph(f"{count()} prompts · 8 business areas · works with ChatGPT, Claude &amp; Gemini", COVER_S),
         PageBreak()]

    s += [Paragraph("How to use this kit", H1)]
    for i, step in enumerate(pb.HOW_TO_USE, 1):
        s.append(Paragraph(f"<b>{i}.</b> {step}", BODY))
        s.append(Spacer(1, 4))
    s += [Spacer(1, 10), Paragraph("The 5-part prompt formula", H2)]
    tbl = Table([[Paragraph(f"<b>{k}</b>", BODY), Paragraph(v, BODY)] for k, v in pb.PROMPT_FORMULA],
                colWidths=[1.3 * inch, 5.2 * inch])
    tbl.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#E5E7EB")),
                             ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    s += [tbl, Spacer(1, 14), Paragraph("Business Context Block (paste this first)", H2),
          boxed(esc(CONTEXT_BLOCK)), PageBreak()]

    if include_playbook:
        s += [Paragraph("Your 7-day quick-start plan", H1),
              Paragraph("One focused hour a day. By day 7 you'll have clear positioning, an offer, "
                        "a month of content, a pipeline and a tracked budget.", BODY), Spacer(1, 8)]
        for day, text in pb.SEVEN_DAY_PLAN:
            s += [KeepTogether([Paragraph(day, PTITLE), Paragraph(text, BODY)])]
        s += [Spacer(1, 14), Paragraph("Your spreadsheets", H2)]
        for name, text in pb.SPREADSHEET_GUIDE:
            s += [KeepTogether([Paragraph(name, PTITLE), Paragraph(text, BODY)])]
        s += [Spacer(1, 6), Paragraph("Works in Excel, Google Sheets (File → Import), Numbers and LibreOffice.", SMALL),
              PageBreak()]

    s += [Paragraph("Contents", H1)]
    for name, blurb, prompts in CATEGORIES:
        s.append(Paragraph(f"<b>{name}</b> ({len(prompts)} prompts): {blurb}", BODY))
        s.append(Spacer(1, 4))
    s.append(PageBreak())

    for ci, (name, blurb, prompts) in enumerate(CATEGORIES, 1):
        s += [Paragraph(name, H1), Paragraph(blurb, SMALL), Spacer(1, 6)]
        for pi, (title, prompt) in enumerate(prompts, 1):
            s.append(KeepTogether([Paragraph(f"{ci}.{pi}  {esc(title)}", PTITLE), Spacer(1, 3),
                                   boxed(esc(prompt))]))
        s.append(PageBreak())

    s += [Paragraph("Keep going", H1),
          Paragraph("Stuck? Use prompt 8.13 (Prompt improver) on any prompt that isn't giving you what you "
                    "need. The best results come from iterating: treat the AI like a sharp junior "
                    "colleague, not a vending machine.", BODY), Spacer(1, 10),
          Paragraph("AI output can be wrong. Check facts, numbers and anything legal, tax or financial "
                    "with a qualified professional before relying on it.", SMALL)]
    doc.build(s, onFirstPage=lambda c, d: None, onLaterPages=footer)


def write_markdown(path):
    lines = [f"# {pb.PRODUCT_NAME}: Prompt Library", "", pb.TAGLINE, "",
             "## Business Context Block (paste first)", "", "```", CONTEXT_BLOCK, "```", ""]
    for ci, (name, blurb, prompts) in enumerate(CATEGORIES, 1):
        lines += [f"## {name}", "", f"_{blurb}_", ""]
        for pi, (title, prompt) in enumerate(prompts, 1):
            lines += [f"### {ci}.{pi} {title}", "", "```", prompt, "```", ""]
    path.write_text("\n".join(lines))


def write_csv(path):
    import csv
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ID", "Category", "Title", "Prompt"])
        for ci, (name, _, prompts) in enumerate(CATEGORIES, 1):
            for pi, (title, prompt) in enumerate(prompts, 1):
                w.writerow([f"{ci}.{pi}", name.split(". ", 1)[1], title, prompt])


README_TXT = """{name}
{rule}

Thanks for your purchase!

START HERE: open "{pdf}" and follow "How to use this kit".

What's inside:
{contents}

Questions or problems with your download? Reply to your receipt email.
"""


def make_tier(tier):
    out = DIST / tier
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    contents = []
    if tier == "starter":
        pdf = "AI Solo Business Prompts.pdf"
        build_pdf(out / pdf, include_playbook=False)
        contents.append(f"  - {pdf}: {count()} prompts across 8 business areas")
    else:
        pdf = "AI Solo Business Kit - Playbook & Prompts.pdf"
        build_pdf(out / pdf)
        sheets.build_profit_tracker(out / "Profit & Cash Flow Tracker.xlsx")
        sheets.build_content_calendar(out / "Content Calendar.xlsx")
        sheets.build_crm(out / "Client CRM & Pipeline.xlsx")
        contents += [f"  - {pdf}: 7-day plan, spreadsheet guide and {count()} prompts",
                     "  - Profit & Cash Flow Tracker.xlsx",
                     "  - Content Calendar.xlsx",
                     "  - Client CRM & Pipeline.xlsx"]
    if tier == "pro":
        write_markdown(out / "Prompt Library (Notion-ready).md")
        write_csv(out / "Prompt Library.csv")
        contents += ["  - Prompt Library (Notion-ready).md: import into Notion, Obsidian or Google Docs",
                     "  - Prompt Library.csv: import into Airtable, Notion databases or a spreadsheet"]
        (out / "LICENSE.txt").write_text(pb.LICENSE_COMMERCIAL.format(name=pb.PRODUCT_NAME))
        contents.append("  - LICENSE.txt: commercial / agency licence")
    else:
        (out / "LICENSE.txt").write_text(pb.LICENSE_PERSONAL.format(name=pb.PRODUCT_NAME))
        contents.append("  - LICENSE.txt: personal use licence")
    (out / "README.txt").write_text(README_TXT.format(
        name=pb.PRODUCT_NAME, rule="=" * len(pb.PRODUCT_NAME), pdf=pdf, contents="\n".join(contents)))

    zpath = DIST / f"{SLUG}-{tier}.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(out.iterdir()):
            z.write(f, arcname=f"{pb.PRODUCT_NAME}/{f.name}")
    return zpath


def render_previews():
    """Render a few PDF pages as images for the sales page (needs pymupdf)."""
    try:
        import pymupdf
    except ImportError:
        print("pymupdf not installed; skipping site previews")
        return
    assets = ROOT.parent / "site" / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(DIST / "complete" / "AI Solo Business Kit - Playbook & Prompts.pdf")
    for name, page in (("cover", 0), ("plan", 2), ("prompts", 5)):
        doc[page].get_pixmap(dpi=110).save(assets / f"preview-{name}.png")
    print("rendered site/assets/preview-*.png")


def main():
    DIST.mkdir(exist_ok=True)
    for tier in ("starter", "complete", "pro"):
        z = make_tier(tier)
        print(f"built {z.relative_to(ROOT.parent)} ({z.stat().st_size // 1024} KB)")
    render_previews()


if __name__ == "__main__":
    main()
