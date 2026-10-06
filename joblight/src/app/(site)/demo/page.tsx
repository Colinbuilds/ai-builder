import type { Metadata } from "next";
import { DemoForm } from "@/components/demo-form";

export const metadata: Metadata = { title: "Book a demo" };

export default async function DemoPage({ searchParams }: { searchParams: Promise<{ users?: string }> }) {
  const n = Number((await searchParams).users);
  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-4 py-16 lg:grid-cols-[0.9fr_1.1fr]">
      <div>
        <h1 className="text-4xl font-bold tracking-tight">See Joblight on your kind of jobs</h1>
        <p className="mt-4 text-lg text-muted">Thirty minutes, no slides. Tell us how your shop runs and we&apos;ll show you how Joblight and Lumen handle it.</p>
        <ul className="mt-6 space-y-2 text-sm text-muted">
          <li>• A walkthrough set up for your trade</li>
          <li>• What setup looks like and how long it takes</li>
          <li>• Exact pricing for your team</li>
        </ul>
      </div>
      <DemoForm users={Number.isInteger(n) && n > 0 ? n : undefined} />
    </div>
  );
}
