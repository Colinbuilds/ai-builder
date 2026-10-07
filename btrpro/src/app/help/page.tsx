import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { housesAddress } from "@/lib/builders/starts-inbox";
import { receiptsAddress } from "@/lib/receipts/inbox";

// "How do I…?" — short, plain step lists for the things people do most. Each one starts from a button they can see.
const GUIDES = (houses: string | null, receipts: string | null) => [
  {
    q: "Add a builder house (DR Horton, etc.)",
    steps: [
      "On Home, press “Add a builder house”.",
      "Have the builder's option sheet PDF? Choose it and press “Read it”. Check what it read, then press the green “Yes — add this house”.",
      "No PDF? Tap the builder, tap the model, pick the elevation and options, type the address, press “Add this house”.",
      ...(houses ? [`Or forward the builder's email to ${houses} — it shows up waiting to be added.`] : []),
    ],
    go: "/builders/add-house",
  },
  {
    q: "Find a job fast",
    steps: ["On Home, type it in the big box — an address (“1234 maple”), a name, or what you want to do (“invoice 1234 maple”).", "Press Go and tap the button that comes up."],
    go: "/",
  },
  {
    q: "Scan a receipt or supplier ticket",
    steps: ["On Home, press “Scan a receipt”.", "Take a photo (or several for a long receipt) or choose the PDF.", "It reads itself — the page fills in. Check the job it picked, then file it.", ...(receipts ? [`Or email the photo to ${receipts}.`] : [])],
    go: "/receipts",
  },
  {
    q: "Move a house along: done → crew paid → billed → paid",
    steps: ["Open the Production schedule and tap the house.", "At the top you'll see the 4 steps. Press the blue button for the next one."],
    go: "/production",
  },
  {
    q: "Invoice a builder house",
    steps: ["Open the job (find it with the big box on Home).", "Job menu → Builder house → Invoice tab.", "Press “Make the … invoice”. It's saved as a draft — send it from Invoices & payments."],
    go: "/",
  },
  {
    q: "See what a house is making",
    steps: ["Open the job → Builder house → Profit tab.", "The left circle is the plan; the right one is what's been spent so far."],
    go: "/",
  },
  {
    q: "See what a builder owes us",
    steps: ["Contacts → Builders → the builder → Statement.", "Use the arrows to change month. Print it or download it for the builder."],
    go: "/builders",
  },
  {
    q: "Crews: see my houses and mark one done",
    steps: ["Crews sign in at the crew portal on their phone.", "“My schedule” lists their houses. Tap one for directions and the material list.", "When it's finished, press the green “Done — tell the office”."],
    go: "/crew",
  },
];

export default async function HelpPage() {
  await requireUser();
  const guides = GUIDES(housesAddress(), receiptsAddress());
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">How do I…?</h1>
        <p className="text-muted-foreground">Tap a question. Stuck anyway? Type what you need in the big box on Home.</p>
      </div>
      {guides.map((g) => (
        <details key={g.q} className="rounded-xl border bg-background p-4 text-base open:shadow-sm">
          <summary className="cursor-pointer text-lg font-semibold">{g.q}</summary>
          <ol className="mt-3 list-decimal space-y-2 pl-6">
            {g.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <Link href={g.go} className="mt-3 inline-block rounded-lg bg-btr-blue px-4 py-2 text-sm font-medium text-white">
            Take me there
          </Link>
        </details>
      ))}
    </div>
  );
}
