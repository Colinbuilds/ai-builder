import { redirect } from "next/navigation";
import { getCurrentCrew } from "@/lib/crew/auth";
import { CrewLoginForm } from "@/components/crew/forms";

export const metadata = { title: "BTR crew portal" };

export default async function CrewLogin() {
  if (await getCurrentCrew()) redirect("/crew");
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="rounded bg-btr-black px-2 py-1 text-xl font-black tracking-wider text-white">BTR</span>
        <h1 className="text-2xl font-semibold">Crew portal</h1>
        <p className="text-sm text-muted-foreground">Send your invoices and job photos to BTR Contracting. The office gives you your login.</p>
      </div>
      <CrewLoginForm />
    </div>
  );
}
