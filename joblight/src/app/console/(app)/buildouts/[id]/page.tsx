import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { BuildoutForm } from "@/components/buildout-form";
import { Health } from "@/components/health";
import { checkNow } from "../../../actions";

export default async function BuildoutPage({ params }: { params: Promise<{ id: string }> }) {
  const b = await prisma.buildout.findUnique({ where: { id: (await params).id } });
  if (!b) notFound();
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{b.company}</h1>
        <Health ok={b.lastCheckOk} ms={b.lastCheckMs} at={b.lastCheckAt} error={b.lastCheckError} />
        <form action={checkNow} className="ml-auto">
          <input type="hidden" name="id" value={b.id} />
          <button className="btn-ghost h-9">Check now</button>
        </form>
        {b.url && (
          <a href={b.url} target="_blank" rel="noreferrer" className="btn h-9">
            Open their site
          </a>
        )}
      </div>
      <BuildoutForm b={b} />
    </div>
  );
}
