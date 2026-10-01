import Link from "next/link";
import { BTR } from "@/lib/company";

// Also what customers and crews see for a link that was turned off or replaced.
export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-3 py-16 text-center">
      <h1 className="text-2xl font-semibold">This page isn&apos;t available</h1>
      <p className="text-muted-foreground">
        The link may be old or turned off. If someone at {BTR.name} sent it to
        you, call{" "}
        <a className="underline" href={`tel:${BTR.phone}`}>
          {BTR.phone}
        </a>{" "}
        for a new one.
      </p>
      <Link href="/" className="text-sm underline">
        BTRpro home
      </Link>
    </div>
  );
}
