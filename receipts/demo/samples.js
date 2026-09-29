// Made-up sample data for the build preview and tests. No real customers or jobs.

var SAMPLE_COMPANY = { name: "Sample Contracting LLC", address: "100 Example Rd, Omaha, NE" };

// Job folder names, written the way contractors name them in Drive.
var SAMPLE_JOBS = [
  "Dana Whitfield - 4410 Maple Ridge Dr Omaha NE",
  "4418 Maple Ridge Dr Lot 7, Prairie Creek",
  "8821 Harvest Ln Lot 12, Prairie Creek",
  "Marcus Lee- 219 W Elm St",
  "Northgate Commons Office Building",
  "Northgate Plaza Retail Center",
  "Rivera Family - 1506 S 52nd Ave",
];

// Receipts as they arrive (email or upload) plus what the AI reads off them.
var SAMPLE_RECEIPTS = [
  {
    id: "r1",
    source: { via: "Email", from: "Luis Ortega", subject: "Whitfield roof - extra materials", body: "Picked up more for the back slope at Whitfield, 4410 Maple Ridge. Soft decking found, customer approved.", received: "Sep 29, 8:12 AM" },
    extracted: {
      employee: "Luis Ortega",
      jobName: "Whitfield",
      address: "4410 Maple Ridge Dr",
      vendor: "ABC Supply Co.",
      date: "2026-09-29",
      receiptNumber: "INV-558201",
      items: [
        { description: "GAF Timberline HDZ Shingles - Charcoal", qty: 12, unit: "bdl", lineTotal: 510.0 },
        { description: "7/16\" OSB Sheathing 4x8", qty: 14, unit: "sht", lineTotal: 238.0 },
        { description: "GAF WeatherWatch Ice & Water 2sq", qty: 2, unit: "rl", lineTotal: 179.98 },
        { description: "Coil Roofing Nails 1-1/4\" 7200ct", qty: 2, unit: "box", lineTotal: 128.0 },
      ],
      subtotal: 1055.98,
      tax: 73.92,
      total: 1129.9,
    },
    action: "change_order",
    reason: "Rotted decking found on back slope during tear-off; customer approved replacement.",
  },
  {
    id: "r2",
    source: { via: "Upload (phone photo)", from: "Jake Brenner", subject: "", body: "", received: "Sep 29, 10:47 AM" },
    extracted: {
      employee: "Jake Brenner",
      jobName: "",
      address: "8821 Harvest Lane",
      vendor: "The Home Depot",
      date: "2026-09-28",
      receiptNumber: "4410 00012 58833",
      items: [
        { description: "Hardie 5/4x4 Trim 12ft Arctic White", qty: 6, unit: "pc", lineTotal: 167.94 },
        { description: "OSI Quad Max Sealant - White", qty: 8, unit: "tube", lineTotal: 79.84 },
        { description: "Z-Flashing 10ft Galvanized", qty: 5, unit: "pc", lineTotal: 44.9 },
      ],
      subtotal: 292.68,
      tax: 20.49,
      total: 313.17,
    },
    action: "invoice",
    reason: "",
  },
  {
    id: "r3",
    source: { via: "Email", from: "Sam Patel", subject: "receipt", body: "northgate job", received: "Sep 29, 1:05 PM" },
    extracted: {
      employee: "Sam Patel",
      jobName: "Northgate",
      address: "",
      vendor: "Menards",
      date: "2026-09-29",
      receiptNumber: "118-3342",
      items: [
        { description: "Owens Corning R-19 Batts 15\" (48.96 sf)", qty: 10, unit: "bag", lineTotal: 449.8 },
        { description: "Great Stuff Window & Door Foam 12oz", qty: 6, unit: "can", lineTotal: 41.88 },
      ],
      subtotal: 491.68,
      tax: 34.42,
      total: 526.1,
    },
    action: "needs_review",
    reason: "",
  },
];

if (typeof module !== "undefined" && module.exports) {
  module.exports = { SAMPLE_COMPANY: SAMPLE_COMPANY, SAMPLE_JOBS: SAMPLE_JOBS, SAMPLE_RECEIPTS: SAMPLE_RECEIPTS };
}
