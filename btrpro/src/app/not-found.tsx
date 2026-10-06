import Link from "next/link";
import { getCompany, appName } from "@/lib/company-profile";

// Also what customers and crews see for a link that was turned off or replaced.
export default async function NotFound() {
  const co = await getCompany();
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-3 py-16 text-center">
      <h1 className="text-2xl font-semibold">This page isn&apos;t available</h1>
      <p className="text-muted-foreground">
        The link may be old or turned off. If someone at {co.name} sent it to
        you, call{" "}
        <a className="underline" href={`tel:${co.phone}`}>
          {co.phone}
        </a>{" "}
        for a new one.
      </p>
      <Link href="/" className="text-sm underline">
        {appName()} home
      </Link>
    </div>
  );
}
