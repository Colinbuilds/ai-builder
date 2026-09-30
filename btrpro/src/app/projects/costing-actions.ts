"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  addChangeOrder,
  addCommitment,
  addCost,
  closeCosting,
  decideChangeOrder,
  deleteCost,
  freezeBaseline,
  importInvoices,
  previewInvoiceImport,
  reopenCosting,
  saveBidResult,
  saveCommissionPlan,
  setCommitmentStatus,
  setNoneExpected,
  type CostActor,
  type ImportPreviewRow,
} from "@/lib/costing/service";
import { COST_CATEGORIES, type CostCategory } from "@/lib/costing/pnl";

export type CResult = {
  problems: string[];
  ok?: boolean;
  note?: string;
} | null;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => {
  const s = str(f, k).replace(/[$,%\s]/g, "");
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s);
  const n = Number(s.replace(/[()]/g, ""));
  return neg ? -n : n;
};
const cat = (f: FormData) => {
  const c = str(f, "category") as CostCategory;
  if (!COST_CATEGORIES.includes(c)) throw new Error("Pick a cost category.");
  return c;
};

async function actor(): Promise<CostActor> {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  return { id: u.id, name: u.name, role: u.role };
}
const done = (projectId: string, note?: string): CResult => {
  revalidatePath(`/projects/${projectId}/costs`);
  return { problems: [], ok: true, note };
};
async function run(
  projectId: string,
  fn: (a: CostActor) => Promise<unknown>,
  note?: string,
): Promise<CResult> {
  const a = await actor();
  try {
    await fn(a);
  } catch (e) {
    return { problems: [msg(e)] };
  }
  return done(projectId, note);
}

export async function addCostAction(_: CResult, f: FormData): Promise<CResult> {
  const projectId = str(f, "projectId");
  const file = f.get("file");
  return run(projectId, async (a) => {
    const d = str(f, "date");
    await addCost(
      projectId,
      {
        category: cat(f),
        date: d ? new Date(`${d}T12:00:00`) : new Date(NaN),
        vendor: str(f, "vendor"),
        reference: str(f, "reference") || null,
        description: str(f, "description"),
        amount: num(f, "amount"),
        kind: str(f, "kind") || undefined,
        hours: num(f, "hours"),
        rate: num(f, "rate"),
        burdenPct: num(f, "burdenPct"),
        commitmentId: str(f, "commitmentId") || null,
        file:
          file instanceof File && file.size
            ? {
                bytes: new Uint8Array(await file.arrayBuffer()),
                name: file.name,
                type: file.type || null,
              }
            : null,
      },
      a,
    );
  });
}

export async function deleteCostAction(
  _: CResult,
  f: FormData,
): Promise<CResult> {
  return run(str(f, "projectId"), (a) =>
    deleteCost(str(f, "costId"), str(f, "reason"), a),
  );
}

export async function addCommitmentAction(
  _: CResult,
  f: FormData,
): Promise<CResult> {
  const projectId = str(f, "projectId");
  return run(projectId, async (a) =>
    addCommitment(
      projectId,
      {
        category: cat(f),
        vendor: str(f, "vendor"),
        description: str(f, "description"),
        amount: num(f, "amount") ?? NaN,
        reference: str(f, "reference") || null,
      },
      a,
    ),
  );
}

export async function commitmentStatusAction(
  _: CResult,
  f: FormData,
): Promise<CResult> {
  return run(str(f, "projectId"), (a) =>
    setCommitmentStatus(
      str(f, "id"),
      str(f, "status") as "OPEN" | "BILLED" | "CANCELLED",
      a,
    ),
  );
}

export async function addChangeOrderAction(
  _: CResult,
  f: FormData,
): Promise<CResult> {
  const projectId = str(f, "projectId");
  return run(projectId, (a) =>
    addChangeOrder(
      projectId,
      {
        kind: str(f, "kind") as "CHANGE_ORDER" | "SUPPLEMENT" | "CREDIT",
        description: str(f, "description"),
        amount: num(f, "amount") ?? NaN,
        costImpact: num(f, "costImpact"),
        source: str(f, "source") || null,
      },
      a,
    ),
  );
}

export async function decideChangeOrderAction(
  _: CResult,
  f: FormData,
): Promise<CResult> {
  return run(str(f, "projectId"), (a) =>
    decideChangeOrder(
      str(f, "id"),
      str(f, "decision") as "APPROVED" | "REJECTED",
      a,
    ),
  );
}

export async function freezeBaselineAction(
  _: CResult,
  f: FormData,
): Promise<CResult> {
  return run(str(f, "projectId"), (a) =>
    freezeBaseline(
      str(f, "projectId"),
      str(f, "estimateId"),
      a,
      str(f, "reason") || null,
    ),
  );
}

export async function noneExpectedAction(
  _: CResult,
  f: FormData,
): Promise<CResult> {
  return run(str(f, "projectId"), async (a) =>
    setNoneExpected(str(f, "projectId"), cat(f), f.get("none") === "1", a),
  );
}

export async function closeCostingAction(
  _: CResult,
  f: FormData,
): Promise<CResult> {
  return run(str(f, "projectId"), (a) => closeCosting(str(f, "projectId"), a));
}

export async function reopenCostingAction(
  _: CResult,
  f: FormData,
): Promise<CResult> {
  return run(str(f, "projectId"), (a) =>
    reopenCosting(str(f, "projectId"), str(f, "reason"), a),
  );
}

export type ImportState = {
  problems: string[];
  ok?: boolean;
  note?: string;
  preview?: {
    rows: ImportPreviewRow[];
    parseProblems: string[];
    pos: string[];
    csv: string;
    fileName: string;
  };
} | null;

export async function invoiceImportAction(
  _: ImportState,
  f: FormData,
): Promise<ImportState> {
  const a = await actor();
  const projectId = str(f, "projectId");
  try {
    if (f.get("step") === "confirm") {
      const csv = str(f, "csv");
      const r = await importInvoices(
        projectId,
        csv,
        {
          pos: f.getAll("po").map(String),
          vendor: str(f, "vendor"),
          file: {
            bytes: new TextEncoder().encode(csv),
            name: str(f, "fileName") || "invoice.csv",
          },
        },
        a,
      );
      revalidatePath(`/projects/${projectId}/costs`);
      return {
        problems: [],
        ok: true,
        note: `Imported ${r.count} line(s), $${r.total.toFixed(2)}${r.skipped ? `; skipped ${r.skipped} already imported` : ""}${r.flagged ? `; ${r.flagged} billed off the price sheet` : ""}.`,
      };
    }
    const file = f.get("file");
    if (!(file instanceof File) || !file.size)
      return {
        problems: [
          "Choose the invoice CSV exported from myABCsupply (or any supplier).",
        ],
      };
    if (file.size > 2_000_000)
      return {
        problems: [
          "That file is over 2 MB. Export one job or date range at a time.",
        ],
      };
    const csv = await file.text();
    const p = await previewInvoiceImport(projectId, csv);
    if (!p.rows.length)
      return {
        problems: p.problems.length ? p.problems : ["No invoice lines found."],
      };
    return {
      problems: [],
      preview: {
        rows: p.rows,
        parseProblems: p.problems,
        pos: p.pos,
        csv,
        fileName: file.name,
      },
    };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}

export async function bidResultAction(
  _: CResult,
  f: FormData,
): Promise<CResult> {
  const projectId = str(f, "projectId");
  const bidders = f.getAll("bidder").map(String);
  const amounts = f
    .getAll("bidAmount")
    .map((v) => String(v).replace(/[$,\s]/g, ""));
  const tabs = bidders
    .map((b, i) => ({
      bidder: b.trim(),
      amount: amounts[i] ? Number(amounts[i]) : NaN,
    }))
    .filter((t) => t.bidder || !Number.isNaN(t.amount));
  const won = str(f, "won");
  return run(projectId, (a) =>
    saveBidResult(
      projectId,
      {
        ourBid: num(f, "ourBid"),
        won: won === "yes" ? true : won === "no" ? false : null,
        tabs,
        notes: str(f, "notes") || null,
      },
      a,
    ),
  );
}

export async function commissionPlanAction(
  _: CResult,
  f: FormData,
): Promise<CResult> {
  const u = await requireUser(["ADMIN"]);
  const pct = num(f, "pct");
  try {
    await saveCommissionPlan(
      str(f, "userId"),
      pct == null
        ? null
        : {
            basis: str(f, "basis") as "REVENUE" | "GROSS_PROFIT",
            pct,
            note: str(f, "note") || null,
          },
      { id: u.id, name: u.name, role: u.role },
    );
  } catch (e) {
    return { problems: [msg(e)] };
  }
  revalidatePath("/settings/company");
  return { problems: [], ok: true };
}
