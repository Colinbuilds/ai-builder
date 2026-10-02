# Growing BTR from $30–40M to $100M: what breaks, and what BTRpro does about it

Research notes (October 2026) behind the growth features in BTRpro. Sources are listed at the end.

## The short version

Contractors don't stall at $30–40M because they run out of work. They stall because of four things:

1. **Cash, not profit, runs out.** Every extra $1M of revenue ties up roughly $150–250K of working
   capital (receivables, retainage, materials bought before billing). Growing 30–40% a year needs
   30–40% more working capital. Profitable contractors fail this way more than any other.
2. **Bonding and bank capacity are capped by what the WIP schedule shows.** Sureties read the
   work-in-progress schedule before almost anything else. Backlog is usually capped at 10–15× equity, and
   underwriters look for over/under-billing swings and profit fade (jobs whose expected margin keeps
   sliding). A contractor without a clean monthly WIP can't get the bonding for bigger work.
3. **Profit leaks between the estimate and the closeout.** Profit fade, unbilled change orders (often put
   at 1–3% of revenue; 77% of specialty contractors have written CO work off as bad debt) and rework
   (around 5% of project cost) all grow with volume. At $100M, 2% leakage is $2M a year.
4. **Knowledge sits in the owner's head.** Above roughly $30M the owner can't review every bid, job and
   crew. The company needs numbers that surface problems by themselves, and documented ways of working
   that don't depend on one person.

Labor shortage (57% of specialty contractors say they're short of workers), crew capacity, subcontractor
compliance and estimating capacity are the other constraints that bite as volume climbs.

## Bottlenecks, benchmarks and what we built

| Bottleneck | What good looks like | Built in BTRpro |
|---|---|---|
| Cash timing | Know the low point 13 weeks ahead; DSO under ~45 days | **13-week cash forecast**: invoices, pay apps, builder billing, supplier bills, crew pay, payroll and overhead by week, with the lowest week flagged |
| Bonding / bank reporting | Monthly WIP: % complete, earned revenue, over/under billing, projected margin vs bid | **WIP schedule** (cost-to-cost), PM cost-to-complete forecasts, monthly snapshots and **profit fade** per job |
| Profit fade | Margin forecast updated monthly; fading jobs caught early | Fade = projected margin − bid margin, flagged at 2+ points; a job forecast to lose money is flagged in red |
| Backlog vs capacity | 8–12 months of backlog; backlog turned into crew weeks | **Owner scorecard**: backlog months, crew weeks queued, revenue trend |
| Estimating throughput | Win rate tracked by customer, type and estimator; pass on low-odds bids | Scorecard: hit rate by market/customer/estimator, bids due in the next 14 days per estimator |
| Change-order leakage | Every extra priced, sent and approved fast | Scorecard: pending COs and how long they've waited |
| Sub/crew compliance | No crew on a job with lapsed insurance; alerts at 60/30/15 days | **Risk desk**: COI and workers' comp expiring or lapsed with open work |
| Lien rights | Never miss the Nebraska 120-day lien deadline on an unpaid job | Risk desk: unpaid jobs with the days left to record a lien |
| Customer concentration | No single GC/builder over ~20–25% of revenue | Scorecard: top customers' share of trailing revenue |
| Contract risk | Pay-if-paid, liquidated damages, broad indemnity caught before signing | **BTRbot contract review**: flags risky clauses with quotes |
| Codes and manufacturer rules | Answers tied to the adopted code edition and the current install instructions | **Code & spec library**: Omaha/Nebraska code adoptions, ICC links, manufacturer documents, and BTRbot research with sources |

## Notes by topic

**Cash.** Construction gets paid in 60–90 days while payroll and suppliers come due weekly, and
retainage holds back another 5–10% until closeout. The standard tool is a rolling 13-week forecast:
each receivable at its realistic clear date (not its due date), retainage on its own conservative row,
and every outflow on its due date.

**WIP and bonding.** A WIP schedule lists each contract's price, cost to date, estimated cost to
complete, % complete, earned revenue and billings. Overbilling is a liability (cash collected ahead
of work); large or growing underbilling suggests unbilled work or estimating trouble. The trend
from month to month matters as much as the number itself.

**Profit fade.** Margin that slides from estimate to closeout. The fix is a monthly cost-to-complete
forecast by the PM, compared with last month's. Labor productivity, unapproved COs and stale forecasts
are the usual causes.

**Estimating.** Typical win rates are about 10–20% on hard-bid public work and 15–25% on competitive
private work, higher on negotiated jobs. Estimators buried in low-odds bids miss the jobs worth winning.
Track win rate by customer, type, size and estimator, and pass early.

**PM span of control.** A seasoned PM runs about 2–5 jobs at a time depending on size and complexity;
PM effort is roughly 7–11% of project cost. Growth means more PMs. The tools that keep that from
multiplying overhead are each PM's own view (already built) plus WIP forecasts that flag their jobs.

**Multi-branch.** Roofing companies that scale past $40–100M do it by standardizing first: one
price book, shared production boards, locked KPI definitions, then layering branches on top.
BTRpro's market split (residential/commercial) and per-PM schedules are the same pattern.

**Compliance.** GL and workers' comp are separate policies with separate expiration dates. A sub
with lapsed WC on your job pushes the payroll onto your WC audit. About 20% of subs lapse at
some point; alerts at 60/30/15 days are the norm.

**Liens (Nebraska).** A construction lien must be recorded within 120 days after the claimant's
last furnishing of labor or materials (Neb. Rev. Stat. § 52-137); for residential protected
parties, a notice of right to lien should be served.

**Codes.** Omaha enforces the 2018 IBC and 2018 IRC, the 2018 IECC for commercial work, the
2012 IMC and the 2023 NEC. Read-only ICC code text is free at codes.iccsafe.org. ASCE 7 wind
speeds by location come from the ASCE Hazard Tool. Manufacturer installation instructions and
specifications (GAF, Hardie, Mule-Hide, etc.) govern the details and the warranty.

## Sources

- ENR, "Specialty Firms Post 2025 Revenue Growth, but Hurdles Remain" — https://www.enr.com/articles/63579-specialty-firms-post-2025-revenue-growth-but-hurdles-remain
- UFG Insurance, "How contractors can maximize their bonding capacity with a WIP schedule" — https://www.ufginsurance.com/about-ufg/ufg-insurance-blog/surety/ufg-insurance-blog/ufg-insurance-blog/2026/04/30/how-contractors-can-maximize-their-bonding-capacity-with-a-wip-schedule
- Pease Bell CPAs, "Reading a WIP Schedule: Over and Under Billings Explained" — https://www.peasebell.com/insights/construction-wip-schedule/
- Commercial Surety, "What Sureties Look for in Your Work in Progress Schedule" — https://commercialsurety.com/what-sureties-look-for-in-your-work-in-progress-schedule/
- Profitability Partners, "Working Capital for Contractors" — https://profitabilitypartners.io/working-capital-contractors/
- CEO Finance Academy, "Construction Cash Flow Problems" — https://www.ceofinanceacademy.com/post/construction-cash-flow-problems
- Second Mile CPA, "13-Week Cash Flow Forecast for Contractors" — https://secondmilecpa.com/insights/13-week-cash-flow-forecast-contractors/
- CLA, "Profit Fade Analysis Helps Construction Companies Keep Projects on Track" — https://www.claconnect.com/en/resources/articles/profit-fade-analysis-helps-construction-companies-keep-projects-on-track
- Clearstory, "2026 Specialty Contractor Change Order Report" — https://www.clearstory.build/construction-blog/2026-sc-change-order-report
- ConstructConnect, "What Good Bid-Hit Ratios Look Like for Commercial GCs in 2026" — https://www.constructconnect.com/blog/bid-hit-ratio-commercial-gcs-2026
- PMI, "Project Management: How Much Is Enough?" — https://www.pmi.org/learning/library/project-management-much-enough-appropriate-5072
- JobNimbus, "Multi-Branch Roofer's Standardization Playbook" — https://www.jobnimbus.com/blog/multi-branch-roofing
- Roofing Contractor, "How Best Choice Roofing Is Scaling AI Across 80 Locations" — https://www.roofingcontractor.com/articles/102049-how-best-choice-roofing-is-scaling-ai-across-80-locations
- Built, "Subcontractor Insurance Requirements" — https://getbuilt.com/blog/subcontractor-insurance-requirements/
- Pins Advantage, "How COI Tracking Protects You in a Workers Comp Audit" — https://www.pinsadvantage.com/resources/blog/coi-tracking-workers-comp-audit
- Projul, "15 Construction KPIs Every Contractor Should Track" — https://projul.com/blog/construction-business-kpis-metrics-guide/
- OpenSpace, "The real cost of rework in construction" — https://www.openspace.ai/blog/cost-of-rework-in-construction/
- Cotney Consulting, "How Roofing Job Costing Improves Future Estimates" — https://www.cotneyconsulting.com/post/roofing-job-cost-feedback-loop
- Siteline, "9 Tips to Help Subcontractors Spot Risk in Construction Contracts" — https://www.siteline.com/blog/9-tips-to-help-subcontractors-spot-risk-in-construction-contracts
- Goosmann Law, "Filing a Construction Lien in Nebraska" — https://www.goosmannlaw.com/filing-a-construction-lien-in-nebraska/
- Nebraska Legislature, Neb. Rev. Stat. § 52-137 — https://nebraskalegislature.gov/laws/statutes.php?statute=52-137
- Submittal, "What Building Code Does Omaha, NE Use?" — https://codes.submittal.app/cities/omaha/
- ICC Digital Codes, 2018 IRC Chapter 9 Roof Assemblies — https://codes.iccsafe.org/content/IRC2018/chapter-9-roof-assemblies
- ASCE Hazard Tool — https://ascehazardtool.org/
