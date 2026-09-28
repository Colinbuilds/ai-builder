// The AI tools offered in the app. Each tool turns a short form into a table
// that the app saves to the customer's Google Drive as a Google Sheet.
//
// fields:  form inputs shown in the app (sent to the model as the brief)
// columns: the table the model must return, one string per cell
// effort:  Claude effort level. "low" for mechanical work, "medium" for writing

export const TOOLS = [
  {
    id: "content-planner",
    name: "Content Planner",
    tagline: "A month of posts with hooks, captions and CTAs",
    icon: "calendar",
    effort: "medium",
    fields: [
      { id: "business", label: "What does your business do?", type: "textarea", required: true,
        placeholder: "e.g. I'm a personal trainer helping busy parents get fit at home" },
      { id: "audience", label: "Who is your ideal customer?", type: "text", required: true,
        placeholder: "e.g. Parents aged 30-45 with no time for the gym" },
      { id: "platforms", label: "Platforms", type: "multi", required: true,
        options: ["Instagram", "TikTok", "LinkedIn", "Facebook", "X / Twitter", "YouTube", "Newsletter"] },
      { id: "goal", label: "Main goal this month", type: "text", required: false,
        placeholder: "e.g. Fill 10 spots in my new 6-week program" },
      { id: "start_date", label: "Start date", type: "date", required: true },
      { id: "days", label: "Number of days", type: "number", required: true, min: 7, max: 31, default: 30 },
    ],
    columns: ["Date", "Day", "Platform", "Pillar", "Hook", "Caption", "Call to action", "Hashtags"],
    system:
      "You are a senior social media strategist for small businesses. Build a practical content " +
      "calendar: one row per post, one post per day, rotating through the chosen platforms. Mix " +
      "pillars roughly 40% educational, 25% story, 20% proof/results, 15% offer. Hooks must stop the " +
      "scroll and be specific to the business. Captions are ready to post (60-150 words, platform-" +
      "appropriate, no emoji spam). Dates are YYYY-MM-DD starting at the start date; Day is the " +
      "weekday name. Hashtags: 3-6 relevant tags, empty for LinkedIn and Newsletter.",
  },
  {
    id: "bookkeeping",
    name: "Bookkeeping Assistant",
    tagline: "Turn a messy bank statement into categorized books",
    icon: "ledger",
    effort: "low",
    fields: [
      { id: "business", label: "What does your business do?", type: "text", required: true,
        placeholder: "e.g. Freelance graphic designer" },
      { id: "country", label: "Country (for tax categories)", type: "text", required: false,
        placeholder: "e.g. United States" },
      { id: "transactions", label: "Paste your transactions", type: "textarea", required: true, rows: 10,
        placeholder: "Copy rows from your bank statement or CSV export and paste them here, e.g.\n" +
          "03/02 STRIPE PAYOUT 1,240.00\n03/04 ADOBE *CREATIVE CLOUD -54.99\n03/05 UBER TRIP -18.20" },
    ],
    columns: ["Date", "Description", "Type", "Category", "Amount", "Tax deductible?", "Notes"],
    system:
      "You are a careful bookkeeper for sole proprietors and freelancers. Convert every transaction " +
      "the user pastes into one row. Type is Income, Expense or Transfer. Category is a standard small-" +
      "business category (e.g. Sales, Software & subscriptions, Advertising, Travel, Meals, Office " +
      "supplies, Contractors, Bank fees, Owner draw). Amount is a plain number without currency " +
      "symbols: positive for income, negative for expenses. Tax deductible? is Likely, Maybe or No. " +
      "Use Notes to flag anything unclear or that the owner should check with an accountant. Never " +
      "invent transactions; keep dates in the format given. This is not tax advice.",
  },
  {
    id: "lead-followup",
    name: "Lead Follow-up Writer",
    tagline: "Prioritized pipeline with a ready-to-send email for every lead",
    icon: "handshake",
    effort: "medium",
    fields: [
      { id: "offer", label: "What do you sell, and at what price?", type: "text", required: true,
        placeholder: "e.g. Website redesigns for dentists, from $3,000" },
      { id: "leads", label: "Your leads and notes", type: "textarea", required: true, rows: 10,
        placeholder: "One lead per line, any format, e.g.\n" +
          "Sarah Lee, Bright Smiles Dental - had a call last week, wants a quote, worried about price\n" +
          "Mike at Downtown Dental - replied to my cold email, asked for examples" },
      { id: "tone", label: "Tone", type: "select", required: true, default: "Friendly and professional",
        options: ["Friendly and professional", "Warm and casual", "Direct and brief", "Formal"] },
    ],
    columns: ["Name", "Company", "Stage", "Priority", "Next action", "Follow up by", "Email subject", "Email draft"],
    system:
      "You are a sales coach for solo business owners. For every lead the user lists, produce one " +
      "row. Stage is one of Lead, Contacted, Discovery call, Proposal sent, Negotiation. Priority is " +
      "High, Medium or Low based on buying signals. Next action is one concrete step. Follow up by is " +
      "a relative timeframe (Today, Tomorrow, In 3 days, Next week). Write a short, personal follow-up " +
      "email (under 120 words) that references the notes, handles any stated objection, and ends with " +
      "one clear, low-friction ask. Never invent facts about a lead beyond the notes.",
  },
  {
    id: "email-sequence",
    name: "Email Sequence Writer",
    tagline: "Welcome, launch or win-back sequences, written for you",
    icon: "mail",
    effort: "medium",
    fields: [
      { id: "business", label: "What does your business do?", type: "textarea", required: true,
        placeholder: "e.g. I sell printable meal planners for busy families" },
      { id: "type", label: "Sequence type", type: "select", required: true, default: "Welcome sequence",
        options: ["Welcome sequence", "Product launch", "Abandoned cart", "Win-back (inactive subscribers)", "Post-purchase onboarding"] },
      { id: "offer", label: "Product or offer to promote", type: "text", required: true,
        placeholder: "e.g. The 12-Week Family Meal Plan, $27" },
      { id: "emails", label: "Number of emails", type: "number", required: true, min: 3, max: 10, default: 5 },
      { id: "voice", label: "Your voice (optional)", type: "text", required: false,
        placeholder: "e.g. Encouraging, a bit funny, no jargon" },
    ],
    columns: ["Email", "Send on day", "Goal", "Subject line", "Preview text", "Body"],
    system:
      "You are a direct-response email copywriter for small online businesses. Write the full " +
      "sequence: one row per email. Email is the number (1, 2, 3...). Send on day is the day after " +
      "signup or trigger (0 for immediately). Subject lines under 45 characters. Bodies are complete, " +
      "ready to send, 120-250 words, plain and personal, with one clear call to action. Use line " +
      "breaks between paragraphs.",
  },
];

export function getTool(id) {
  return TOOLS.find((t) => t.id === id);
}

// Public view of the tools (no prompts) for the app's UI.
export function publicTools() {
  return TOOLS.map(({ system, effort, ...rest }) => rest);
}

// JSON schema the model's answer must follow for a tool.
export function outputSchema(tool) {
  const rowProps = {};
  for (const c of tool.columns) rowProps[c] = { type: "string" };
  return {
    type: "object",
    properties: {
      title: { type: "string", description: "Short title for the spreadsheet, under 60 characters" },
      rows: {
        type: "array",
        items: { type: "object", properties: rowProps, required: tool.columns, additionalProperties: false },
      },
    },
    required: ["title", "rows"],
    additionalProperties: false,
  };
}

const MAX_FIELD_CHARS = 20000;

// Validate form input and turn it into the brief sent to the model.
// Returns { brief } or { error }.
export function buildBrief(tool, inputs) {
  if (!inputs || typeof inputs !== "object") return { error: "Missing form input." };
  const lines = [];
  for (const f of tool.fields) {
    let v = inputs[f.id];
    if (Array.isArray(v)) v = v.filter((x) => f.options?.includes(x)).join(", ");
    v = v == null ? "" : String(v).trim();
    if (f.required && !v) return { error: `Please fill in "${f.label}".` };
    if (v.length > MAX_FIELD_CHARS) return { error: `"${f.label}" is too long. Please shorten it.` };
    if (f.type === "number" && v) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < f.min || n > f.max) {
        return { error: `"${f.label}" must be a whole number from ${f.min} to ${f.max}.` };
      }
    }
    if (f.type === "select" && v && !f.options.includes(v)) return { error: `Invalid choice for "${f.label}".` };
    if (v) lines.push(`${f.label}\n${v}`);
  }
  return { brief: lines.join("\n\n") };
}
