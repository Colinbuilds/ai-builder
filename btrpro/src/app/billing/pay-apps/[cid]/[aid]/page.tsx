import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { BILLING_ROLES } from "@/lib/roles";
import type { SovLine } from "@/lib/billing/payapps";
import { PayAppEditor } from "@/components/billing/payapp-forms";
import { deletePayAppAction, payAppStatusAction } from "../../actions";

export default async function PayAppPage({ params }: { params: Promise<{ cid: string; aid: string }> }) {
  const user = await requireUser();
  const { cid, aid } = await params;
  const a = await prisma.payApp.findUnique({ where: { id: aid }, include: { contract: true } });
  if (!a || a.contractId !== cid) notFound();
  const can = (BILLING_ROLES as readonly string[]).includes(user.role);
  const locked = a.status !== "DRAFT" || !can;
  const status = (s: string, label: string) => (
    <form action={payAppStatusAction}>
      <input type="hidden" name="id" value={a.id} />
      <input type="hidden" name="status" value={s} />
      <button className="h-8 rounded-md border px-3 text-sm hover:bg-muted">{label}</button>
    </form>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <Link href={`/billing/pay-apps/${cid}`} className="text-sm text-muted-foreground hover:underline">
          ← {a.contract.project}
        </Link>
        <h1 className="text-2xl font-semibold">Application #{a.number}</h1>
        <span className="text-sm text-muted-foreground">
          period to {a.periodTo.toLocaleDateString("en-US")} · {a.status.toLowerCase()} · retainage {a.retainagePct}% · submit through {a.contract.submitVia ?? "—"}
        </span>
        <a href={`/api/pay-apps/${a.id}`} target="_blank" className="ml-auto rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
          G702 + G703 PDF
        </a>
      </div>
      <PayAppEditor id={a.id} lines={a.lines as SovLine[]} retainagePct={a.retainagePct} locked={locked} />
      {can && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          {a.status === "SUBMITTED" && status("PAID", "Mark paid")}
          {a.status !== "DRAFT" && status("DRAFT", "Reopen as draft")}
          {a.status === "DRAFT" && (
            <form action={deletePayAppAction}>
              <input type="hidden" name="id" value={a.id} />
              <button className="h-8 rounded-md border border-red-300 px-3 text-sm text-red-700 hover:bg-red-50">Delete draft</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
