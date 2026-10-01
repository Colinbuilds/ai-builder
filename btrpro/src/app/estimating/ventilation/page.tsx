import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { VentilationCalc } from "@/components/estimates/ventilation-calc";

export default async function VentilationPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  await requireUser();
  const { job } = await searchParams;
  let attic: number | null = null;
  let source: string | null = null;
  if (job) {
    const ms = await prisma.measurement.findMany({ where: { projectId: job, key: "attic_sf", status: { in: ["CONFIRMED", "USER_ENTERED"] } }, include: { project: { select: { name: true } } } });
    if (ms.length) {
      attic = Math.round(ms.reduce((s, m) => s + (m.value ?? 0), 0));
      source = `${ms[0].project.name} — attic floor area (${ms.length} measurement${ms.length === 1 ? "" : "s"})`;
    }
  }
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Ventilation calculator</h1>
        <p className="text-sm text-muted-foreground">Code-required attic ventilation, Lomanco&apos;s method. Vent ratings come from the manufacturer; anything not listed is entered by hand.</p>
      </div>
      <VentilationCalc initialAttic={attic} source={source} />
    </div>
  );
}
