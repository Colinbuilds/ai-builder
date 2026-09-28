"""Quick-start playbook text for the AI Solo Business Kit."""

PRODUCT_NAME = "The AI Solo Business Kit"
TAGLINE = "100 AI prompts + 3 ready-to-use business spreadsheets to run your one-person business."
VERSION = "1.0"

HOW_TO_USE = [
    "Open ChatGPT, Claude, Gemini or any AI assistant and start a new chat.",
    "Paste the <b>Business Context Block</b> (next page) first, filled in with your details. "
    "Every prompt after it will then be tailored to your business automatically.",
    "Pick a prompt, replace anything in [BRACKETS], and send it.",
    "Don't settle for the first answer. Reply with 'make it shorter', 'more casual', "
    "'give me 5 more options', or 'what would a skeptic say?'",
    "Save the outputs you like into the matching spreadsheet: content into the Content Calendar, "
    "leads into the Client CRM, and numbers into the Profit &amp; Cash Flow Tracker.",
]

PROMPT_FORMULA = [
    ("Role", "Who should the AI act as? e.g. 'Act as a conversion copywriter.'"),
    ("Context", "Your business, customer and goal. The Context Block covers this."),
    ("Task", "Exactly what you want produced."),
    ("Constraints", "Length, tone, reading level, what to avoid."),
    ("Format", "Table, bullet list, email, script, with headings, etc."),
]

SEVEN_DAY_PLAN = [
    ("Day 1: Positioning",
     "Run prompts 1.1 (Ideal customer), 1.3 (Value proposition) and 1.10 (Elevator pitch). "
     "Paste your best value proposition into your social bios."),
    ("Day 2: Offer",
     "Run 1.5 (Offer stack) and 1.6 (Pricing). Decide on your 3 price tiers."),
    ("Day 3: Numbers",
     "Open the Profit &amp; Cash Flow Tracker. Enter last month's income and expenses, then run "
     "6.1 (Revenue goal breakdown) with your real numbers."),
    ("Day 4: Content",
     "Run 2.1 (30-day calendar) and paste the table into the Content Calendar sheet. "
     "Batch-write the first week with 2.2 (Hooks) and 2.3 (Repurpose)."),
    ("Day 5: List",
     "Run 3.1 (Lead magnet ideas), make the simplest one, then write your welcome sequence with 3.2."),
    ("Day 6: Pipeline",
     "Add 20 prospects to the Client CRM. Use 4.1 (Cold email) or 4.2 (LinkedIn DM) to contact 5 of them."),
    ("Day 7: Systems",
     "Run 5.3 (Automation finder) and 5.1 (SOP writer) on your most repetitive task. "
     "Finish with 8.9 (Quarterly review) to lock in your next 90 days."),
]

SPREADSHEET_GUIDE = [
    ("Profit &amp; Cash Flow Tracker.xlsx",
     "Set your currency symbol, tax set-aside % and year on the <b>Settings</b> tab. Log every sale and "
     "expense on <b>Transactions</b>, choosing a category from the dropdown. The <b>Dashboard</b> "
     "updates automatically with monthly income, expenses, profit, tax to set aside and a year-to-date "
     "total."),
    ("Content Calendar.xlsx",
     "Plan posts on the <b>Calendar</b> tab: date, platform, pillar, hook, format, CTA and status. "
     "The <b>Summary</b> tab counts posts by status and platform so you can see your pipeline at a glance."),
    ("Client CRM &amp; Pipeline.xlsx",
     "Track every lead on <b>Pipeline</b>. Choose a stage and the win probability and weighted value "
     "are filled in for you. Follow-ups that are due or overdue turn red. The <b>Forecast</b> tab totals "
     "deal value and weighted value by stage."),
]

LICENSE_PERSONAL = """PERSONAL USE LICENCE - {name}

You may:
  - Use the prompts and spreadsheets in your own business, for yourself and your own clients' work.
  - Edit and adapt everything for your own use.

You may not:
  - Resell, share, give away or redistribute the kit or any part of it (including the prompt list
    or spreadsheet templates) as-is or modified.
  - Include it in a product, course, membership or bundle you sell.

For agency or resale rights, upgrade to the Pro licence.
"""

LICENSE_COMMERCIAL = """COMMERCIAL / AGENCY LICENCE - {name} (Pro)

Everything in the Personal Use Licence, plus:
  - Use the kit to deliver work for unlimited clients.
  - Give customised copies of the spreadsheets to your clients as part of a paid service.
  - Include up to 25 of the prompts, rewritten in your own words, in your own paid products.

You may not:
  - Resell or redistribute the complete kit, or more than 25 prompts, as a standalone product.
  - Claim authorship of the original kit.
"""
