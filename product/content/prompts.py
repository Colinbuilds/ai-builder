"""Prompt library for the AI Solo Business Kit.

Each category is (name, blurb, [(title, prompt), ...]).
Placeholders in [BRACKETS] are filled in by the buyer.
"""

CONTEXT_BLOCK = (
    "I run [BUSINESS NAME], a [TYPE OF BUSINESS] that helps [IDEAL CUSTOMER] "
    "achieve [MAIN OUTCOME]. My offer is [OFFER] priced at [PRICE]. "
    "My tone is [TONE, e.g. warm and direct]. Keep this context for every answer in this chat."
)

CATEGORIES = [
    (
        "1. Offer & Positioning",
        "Get clear on who you serve, what you sell and why anyone should pick you.",
        [
            ("Ideal customer profile",
             "Using my business context, build a detailed ideal customer profile: demographics, job/role, "
             "top 5 frustrations in their own words, what they have already tried, what they fear, and what "
             "a win looks like for them in 90 days. Finish with 3 places they spend time online."),
            ("Pain-point mining",
             "List 20 specific, painful problems [IDEAL CUSTOMER] has around [TOPIC]. For each, write the "
             "exact phrase they'd type into Google or say to a friend. Rank by urgency."),
            ("Unique value proposition",
             "Write 10 one-sentence value propositions for my offer using the formula: 'I help [WHO] get "
             "[RESULT] without [PAIN] in [TIMEFRAME].' Then pick the strongest one and explain why."),
            ("Competitor gap analysis",
             "Here are 3 competitors and what they offer: [PASTE]. Identify what they all do the same, what "
             "customers likely complain about, and 5 positioning angles I could own that they ignore."),
            ("Offer stack builder",
             "Design an irresistible offer for [RESULT]. Include the core deliverable, 3 bonuses that remove "
             "objections, a guarantee, and a reason to buy now. Show the perceived value of each part."),
            ("Pricing sanity check",
             "I plan to charge [PRICE] for [OFFER]. Given my customer is [IDEAL CUSTOMER], argue for a lower "
             "price, argue for a higher price, then recommend a 3-tier pricing structure with names."),
            ("Productize a service",
             "I currently sell [SERVICE] as custom work. Turn it into a fixed-scope, fixed-price package with "
             "a clear name, deliverables, timeline, what's excluded, and an upsell."),
            ("Niche down",
             "My current audience is [BROAD AUDIENCE]. Suggest 10 narrower niches ranked by willingness to "
             "pay, ease of reaching them, and how much my skills stand out there."),
            ("Brand name ideas",
             "Generate 25 brand or product names for [OFFER] aimed at [IDEAL CUSTOMER]. Mix descriptive, "
             "invented, and metaphor names. Flag which are likely easy to get a .com for."),
            ("Elevator pitch",
             "Write my elevator pitch in 3 lengths: 10 seconds, 30 seconds, 60 seconds. Make it "
             "conversational, not salesy, and end each with a natural question."),
            ("Customer interview script",
             "Write a 15-minute customer discovery interview script with 10 open questions to validate "
             "demand for [IDEA]. Avoid leading questions. Include what signals mean 'yes, build it'."),
            ("Mission & story",
             "Using these facts about me: [BACKGROUND], write a 150-word founder story for my About page "
             "that connects my experience to my customer's problem. No clichés."),
        ],
    ),
    (
        "2. Content & Social Media",
        "A month of content in an afternoon, in your voice.",
        [
            ("30-day content calendar",
             "Create a 30-day content calendar for [PLATFORM] targeting [IDEAL CUSTOMER]. Mix: 40% "
             "educational, 25% story, 20% proof/results, 15% offer. Give each day a hook, format, and CTA. "
             "Output as a table I can paste into a spreadsheet."),
            ("Hook generator",
             "Write 30 scroll-stopping hooks about [TOPIC] for [IDEAL CUSTOMER]. Use these styles: "
             "contrarian, number list, mistake, curiosity gap, before/after, and 'nobody tells you'."),
            ("Repurpose one idea",
             "Take this piece of content: [PASTE]. Turn it into: 1 LinkedIn post, 1 X/Twitter thread "
             "(7 posts), 1 Instagram carousel (8 slides of text), 1 short video script (45s), and 1 email."),
            ("Carousel script",
             "Write a 10-slide carousel teaching [SKILL] in simple steps. Slide 1 is the hook, slides 2-9 "
             "one idea each (max 20 words), slide 10 a CTA to [ACTION]."),
            ("Short video script",
             "Write 5 short-form video scripts (under 45 seconds) about [TOPIC]. Format: hook (first 2 "
             "seconds), 3 beats, CTA. Include on-screen text suggestions."),
            ("Storytelling post",
             "Turn this experience into a story post: [WHAT HAPPENED]. Structure: tension, turning point, "
             "lesson, link to how I help [IDEAL CUSTOMER]. Under 250 words."),
            ("Content pillars",
             "Suggest 5 content pillars for my business, each with 10 post ideas. Pillars should build "
             "trust, show expertise, and lead naturally to my offer."),
            ("Blog post outline (SEO)",
             "Create an SEO blog outline for the keyword '[KEYWORD]'. Include search intent, H1, H2/H3 "
             "structure, FAQs people also ask, internal link ideas, and a meta description under 155 chars."),
            ("Full blog draft",
             "Write a 1,200-word blog post from this outline: [PASTE]. Use short paragraphs, concrete "
             "examples, and one clear CTA to [OFFER]. Write at an 8th-grade reading level."),
            ("YouTube title & description",
             "For a video about [TOPIC], write 10 click-worthy but honest titles, a 200-word description "
             "with keywords, 5 chapter timestamps placeholders, and 15 tags."),
            ("Engagement replies",
             "Here are comments on my post: [PASTE]. Draft warm, human replies that continue the "
             "conversation, and flag any that are warm leads I should DM."),
            ("Newsletter name & format",
             "Suggest 10 newsletter names for [AUDIENCE] and a repeatable weekly format with 4 sections "
             "that takes under 1 hour to write."),
            ("Trend jacker",
             "Here is a current trend/news item: [PASTE]. Give 5 angles to connect it to [MY TOPIC] "
             "without being cringe, each with a post draft."),
        ],
    ),
    (
        "3. Email Marketing",
        "Sequences that nurture and sell while you sleep.",
        [
            ("Lead magnet ideas",
             "Brainstorm 15 lead magnets for [IDEAL CUSTOMER] that can be made in under 3 hours "
             "(checklists, templates, mini-guides). Rank by perceived value and relevance to [OFFER]."),
            ("Welcome sequence",
             "Write a 5-email welcome sequence for new subscribers who downloaded [LEAD MAGNET]. Email 1: "
             "deliver + quick win. 2: my story. 3: biggest mistake. 4: case study. 5: soft pitch for [OFFER]. "
             "Include subject lines and preview text."),
            ("Launch sequence",
             "Write a 7-email launch sequence for [OFFER] over 7 days: announce, problem, solution, proof, "
             "FAQ/objections, last chance (24h), closing (3h). Include urgency without being pushy."),
            ("Subject line tester",
             "Write 20 subject lines for an email about [TOPIC]. Label each with the tactic used "
             "(curiosity, benefit, urgency, personal, question). Keep under 45 characters."),
            ("Re-engagement email",
             "Write a 3-email win-back sequence for subscribers who haven't opened in 60 days. Last email "
             "should let them unsubscribe gracefully."),
            ("Abandoned cart",
             "Write a 3-email abandoned-checkout sequence for [PRODUCT] at [PRICE]: reminder (1h), "
             "objection handling (24h), small incentive (48h)."),
            ("Weekly newsletter draft",
             "Draft this week's newsletter using these notes: [BULLETS]. Friendly tone, one main lesson, "
             "one link, one P.S. that mentions [OFFER]."),
            ("Post-purchase onboarding",
             "Write a 4-email onboarding sequence for buyers of [PRODUCT] that gets them to their first "
             "win in 7 days, asks for feedback on day 10, and requests a testimonial on day 14."),
            ("Testimonial request",
             "Write a short email asking happy customers for a testimonial. Include 4 guided questions so "
             "their answers read like a before/after story."),
            ("Upsell email",
             "Customers who bought [PRODUCT A] often need [PRODUCT B]. Write an email that makes the "
             "connection naturally and offers a 48-hour buyer discount."),
            ("Plain-text sales email",
             "Write a plain-text, personal-sounding sales email for [OFFER] that reads like it's from a "
             "friend. Under 200 words. One link."),
            ("Segmentation survey",
             "Write a 1-question email survey that segments my list into 3 groups by [NEED/STAGE], plus "
             "the follow-up email each segment should get."),
        ],
    ),
    (
        "4. Sales & Client Acquisition",
        "Find, pitch and close clients with less awkwardness.",
        [
            ("Cold email",
             "Write 3 cold email variants to [PROSPECT ROLE] at [COMPANY TYPE] offering [SERVICE]. Under "
             "120 words, personalised first line placeholder, one clear low-friction ask."),
            ("LinkedIn DM opener",
             "Write 5 LinkedIn connection notes and follow-up DMs to [PROSPECT] that start a conversation "
             "without pitching in the first message."),
            ("Follow-up sequence",
             "Write a 4-touch follow-up sequence for a prospect who went quiet after [STAGE]. Space them "
             "over 3 weeks, add value each time, final one is a polite breakup email."),
            ("Discovery call agenda",
             "Create a 30-minute discovery call agenda with questions that uncover budget, urgency, "
             "decision-makers and the cost of not solving [PROBLEM]."),
            ("Objection handling",
             "List the 10 most likely objections to buying [OFFER] at [PRICE] and write a calm, honest "
             "response to each. Include 'I need to think about it' and 'it's too expensive'."),
            ("Proposal writer",
             "Write a one-page proposal for [CLIENT] who needs [PROBLEM SOLVED]. Sections: their goal, "
             "my approach, deliverables, timeline, investment (3 options), next step."),
            ("Case study",
             "Turn these client results into a case study: [NOTES]. Structure: client, challenge, "
             "solution, measurable results, quote. Also give a 3-sentence version for social."),
            ("Sales page",
             "Write a long-form sales page for [OFFER]. Sections: headline, subhead, problem, agitation, "
             "solution, what's inside, who it's for/not for, testimonials placeholders, guarantee, FAQ, CTA."),
            ("Referral ask",
             "Write a message asking past clients for referrals, with a simple incentive and a "
             "copy-paste blurb they can forward."),
            ("Partnership pitch",
             "Write a pitch to [POTENTIAL PARTNER] (who serves the same audience) proposing a "
             "collaboration: joint webinar, bundle, or affiliate deal. Make the win for them obvious."),
            ("Price increase notice",
             "Write a respectful email telling existing clients my rates go from [OLD] to [NEW] on [DATE], "
             "with a grandfather option."),
            ("Upwork/Fiverr profile",
             "Write a freelance marketplace profile for [SKILL] with a keyword-rich headline, 3-paragraph "
             "overview, and 3 service packages (basic/standard/premium)."),
            ("Sales script role-play",
             "Act as a skeptical prospect for [OFFER]. Ask me tough questions one at a time, then score "
             "my answers and tell me how to improve."),
        ],
    ),
    (
        "5. Operations & Productivity",
        "Systems that give you your time back.",
        [
            ("SOP writer",
             "Write a step-by-step standard operating procedure for [TASK] that a new assistant could "
             "follow on day one. Include tools, checklists, and common mistakes."),
            ("Weekly planning",
             "Here are my goals [GOALS] and this week's tasks [TASKS]. Prioritise with the Eisenhower "
             "matrix, time-block my week into focused sessions, and tell me what to drop."),
            ("Automation finder",
             "List every recurring task in my business based on this description: [DESCRIBE WEEK]. "
             "Suggest which can be automated, with specific no-code tools (Zapier, Make, etc.) for each."),
            ("Client onboarding checklist",
             "Create a client onboarding checklist for [SERVICE] from signed contract to kickoff, plus "
             "a welcome email and intake questionnaire."),
            ("Meeting notes to actions",
             "Turn these meeting notes into: a 3-line summary, decisions made, action items with owners "
             "and deadlines, and a follow-up email: [PASTE NOTES]."),
            ("Contract clause explainer",
             "Explain this contract clause in plain English and list any risks for me as a freelancer: "
             "[PASTE]. (Not legal advice—flag when I should see a lawyer.)"),
            ("Scope creep response",
             "A client asked for [EXTRA WORK] outside our agreed scope. Write a friendly reply that "
             "protects the relationship and offers it as a paid add-on."),
            ("Hiring a VA",
             "Write a job post for a part-time virtual assistant to handle [TASKS], plus 5 screening "
             "questions and a small paid test task."),
            ("Tool stack audit",
             "Here is my tool stack and monthly cost: [LIST]. Identify overlaps, cheaper alternatives, "
             "and what I can cancel without losing anything."),
            ("90-day plan",
             "Build a 90-day plan to reach [GOAL]. Break it into 3 monthly milestones, weekly focus "
             "areas, and a daily 1-hour non-negotiable action."),
            ("Decision helper",
             "I'm deciding between [OPTION A] and [OPTION B]. Ask me 5 clarifying questions first, then "
             "give a pros/cons table, second-order effects, and a recommendation."),
            ("Inbox triage",
             "Here are the subjects and first lines of my unread emails: [PASTE]. Sort them into reply "
             "now, delegate, schedule, and archive, and draft 2-line replies for the 'reply now' group."),
            ("FAQ page",
             "Write an FAQ page for [BUSINESS] answering the 12 questions customers ask most, based on "
             "these real questions I get: [PASTE]."),
        ],
    ),
    (
        "6. Money & Finance",
        "Know your numbers. Pair these with the Profit & Cash Flow Tracker.",
        [
            ("Revenue goal breakdown",
             "My annual revenue goal is [AMOUNT]. Reverse-engineer it: how many sales/clients per month "
             "at my prices [PRICES], and how many leads I need at a [X]% conversion rate."),
            ("Profit leak finder",
             "Here are my last 3 months of expenses: [PASTE]. Categorise them, flag anything unusual or "
             "wasteful, and estimate annual savings from cutting it."),
            ("Pricing calculator logic",
             "Help me calculate an hourly/project rate. I want to earn [TAKE-HOME] a year, work [HOURS] "
             "billable hours a week, [WEEKS] weeks a year, with [EXPENSES] in costs and [TAX]% tax."),
            ("Cash flow forecast",
             "Using this income and expense data [PASTE], create a simple 6-month cash flow forecast "
             "with best/expected/worst cases and the month I'm most at risk."),
            ("Invoice & payment reminders",
             "Write 3 escalating payment reminder emails for an invoice that is 7, 14 and 30 days "
             "overdue. Firm but professional."),
            ("Tax-time prep checklist",
             "Create a year-end checklist for a [COUNTRY] sole proprietor/freelancer to prepare for "
             "taxes: documents to gather and common deductible categories to ask an accountant about."),
            ("Unit economics",
             "Calculate the customer acquisition cost, lifetime value and payback period from these "
             "numbers: [AD SPEND, CUSTOMERS, AVG ORDER, REPEAT RATE]. Explain what to improve first."),
            ("Recurring revenue ideas",
             "Suggest 10 ways to add recurring revenue (retainers, memberships, subscriptions) to "
             "[BUSINESS], with a price and expected effort for each."),
            ("Budget for growth",
             "I have [AMOUNT] to invest in growth this quarter. Suggest how to allocate it between ads, "
             "tools, outsourcing and education, and what result to expect from each."),
            ("Financial health check",
             "Here are my monthly numbers: revenue [X], expenses [Y], cash in bank [Z], owed to me [W]. "
             "Give me a plain-English health check and 3 priorities."),
            ("Discount strategy",
             "Should I run a sale for [PRODUCT]? Model the revenue impact of 20%, 30% and 50% off at "
             "different volume lifts, and suggest a discount that won't cheapen my brand."),
            ("Money mindset reframe",
             "I feel uncomfortable charging [PRICE]. Challenge my thinking with the value delivered to "
             "the client, and give me a script to state my price confidently."),
        ],
    ),
    (
        "7. Customer Experience & Support",
        "Happy customers buy again and tell friends.",
        [
            ("Support macro library",
             "Write 10 reusable customer support replies for [BUSINESS] covering: refunds, delays, "
             "login/access issues, how-to questions, complaints, and feature requests."),
            ("Angry customer reply",
             "A customer wrote this: [PASTE]. Write a calm, empathetic reply that acknowledges the "
             "problem, takes ownership, and offers a clear fix."),
            ("Review response",
             "Write responses to these reviews (positive and negative) that sound human and show future "
             "readers I care: [PASTE REVIEWS]."),
            ("Feedback survey",
             "Create a 7-question customer feedback survey that measures satisfaction, uncovers what "
             "they'd pay more for, and collects a testimonial."),
            ("Analyse feedback",
             "Here is raw customer feedback: [PASTE]. Group it into themes, rank by frequency, and "
             "suggest the 3 changes with the biggest impact."),
            ("Loyalty program",
             "Design a simple loyalty or referral program for [BUSINESS] with rewards that cost me "
             "little but feel valuable to [IDEAL CUSTOMER]."),
            ("Offboarding",
             "Write an offboarding email for clients whose project just ended: summary of results, "
             "next-step recommendations, a review request and a re-hire offer."),
            ("Help center article",
             "Write a help article explaining how to [TASK] in my product. Numbered steps, screenshots "
             "placeholders, and a troubleshooting section."),
            ("Chatbot knowledge base",
             "Turn this information about my business [PASTE] into a Q&A knowledge base I can load into "
             "a support chatbot. Keep answers under 60 words."),
            ("Surprise & delight",
             "Suggest 15 low-cost ways to surprise and delight customers of [BUSINESS] at key moments "
             "(purchase, milestone, anniversary)."),
            ("Churn diagnosis",
             "Customers cancel after about [TIME]. Here's what they say: [PASTE]. Diagnose likely causes "
             "and suggest onboarding or product fixes."),
            ("Community rules",
             "Write welcome message and 8 community guidelines for my [PLATFORM] customer community "
             "that encourage participation and keep it spam-free."),
        ],
    ),
    (
        "8. Growth & Strategy",
        "Step back and steer.",
        [
            ("SWOT analysis",
             "Run a SWOT analysis on my business using this info: [PASTE]. End with 3 strategic moves "
             "that use strengths to capture opportunities."),
            ("Growth experiments",
             "Suggest 12 low-cost growth experiments for [BUSINESS] with a hypothesis, how to measure it, "
             "and how long to run it. Rank by ICE score (impact, confidence, ease)."),
            ("New product idea validator",
             "I'm thinking of launching [IDEA]. Play devil's advocate, estimate the market, list "
             "assumptions to test, and design a 7-day validation test that costs under $100."),
            ("Digital product ideas",
             "Based on my expertise in [SKILL], suggest 15 digital products I could create (templates, "
             "guides, courses, toolkits) with price points and build time."),
            ("Landing page teardown",
             "Here's my landing page copy: [PASTE]. Critique it like a conversion copywriter: clarity, "
             "hook, proof, objections, CTA. Rewrite the hero section."),
            ("Ad copy",
             "Write 5 Facebook/Instagram ad variations for [OFFER] targeting [AUDIENCE]: primary text, "
             "headline, description. Test different angles (pain, gain, social proof)."),
            ("Webinar outline",
             "Outline a 45-minute webinar that teaches [TOPIC] and transitions naturally into selling "
             "[OFFER]. Include slide titles and timing."),
            ("Podcast guest pitch",
             "Write a pitch to be a guest on [PODCAST]. Include 3 episode topic ideas tailored to their "
             "audience and why I'm credible."),
            ("Quarterly review",
             "Guide me through a quarterly business review. Ask me one question at a time about wins, "
             "numbers, lessons and energy, then summarise and set next quarter's top 3 goals."),
            ("Personal brand audit",
             "Here are my bio, recent posts and website headline: [PASTE]. Is my positioning clear and "
             "consistent? Rewrite my bio for [PLATFORM]."),
            ("Scale without burnout",
             "I'm at capacity doing [WORK]. Suggest ways to scale revenue without more hours: raising "
             "prices, productising, delegating, group programs. Model the income for each."),
            ("Board of advisors",
             "Act as a board of 3 advisors: a marketer, a finance expert, and an operator. Each reviews "
             "my plan [PASTE] and gives blunt feedback. Then agree on one recommendation."),
            ("Prompt improver",
             "Here is a prompt I use: [PASTE]. Rewrite it to get better results: add role, context, "
             "constraints, examples and output format. Explain what you changed."),
        ],
    ),
]


def count():
    return sum(len(p) for _, _, p in CATEGORIES)


if __name__ == "__main__":
    print(count(), "prompts")
