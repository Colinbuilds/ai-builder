// Readiness is computed, never set by hand (BUILD_PROMPT §2).
//   NOT_READY  — anything MISSING that blocks a number
//   BUDGET     — a number exists, but it rests on assumptions / placeholders / unapproved waste
//   BID_READY  — none of the above
import { botName } from "@/lib/brand-names";
export type Readiness = "NOT_READY" | "BUDGET" | "BID_READY";

export type ReadinessInput = {
  projectId: string;
  intake: { key: string; label: string; status: string }[]; // relevant fields only matter; N/A is skipped
  estimate: null | {
    id: string;
    name: string;
    wasteApproved: boolean;
    lines: { id: string; itemName: string; sourceStatus: string; sheetStatus?: string | null }[];
    labor: { id: string; task: string; sourceStatus: string }[];
  };
  expiredSheets: string[]; // live sheets that are EXPIRED
};

export type Blocker = { severity: "blocks_number" | "assumption"; message: string; href: string };

const HARD_LINE = new Set(["MISSING", "MISSING_ITEM", "MISSING_PRICE", "CALL_FOR_PRICE", "PENDING_AI", "SHEET_EXPIRED"]);
const SOFT_LINE = new Set(["PLACEHOLDER", "ASSUMPTION_APPROVED"]);
const LABEL: Record<string, string> = {
  get PENDING_AI() {
    return `${botName()} suggestion not yet accepted`;
  },
  MISSING: "missing",
  MISSING_ITEM: "item not on any loaded sheet",
  MISSING_PRICE: "no price",
  CALL_FOR_PRICE: "CALL for price — get a quote",
  SHEET_EXPIRED: "priced from an expired sheet",
  PLACEHOLDER: "placeholder value",
  ASSUMPTION_APPROVED: "approved assumption",
};

export function computeReadiness(input: ReadinessInput): { readiness: Readiness; blockers: Blocker[] } {
  const b: Blocker[] = [];
  const p = `/projects/${input.projectId}`;

  for (const f of input.intake) {
    if (f.status === "MISSING") b.push({ severity: "blocks_number", message: `Intake: ${f.label} is MISSING`, href: `${p}#intake-${f.key}` });
    if (f.status === "ASSUMED") b.push({ severity: "assumption", message: `Intake: ${f.label} is an assumption`, href: `${p}#intake-${f.key}` });
  }
  for (const s of input.expiredSheets)
    b.push({ severity: "blocks_number", message: `Price sheet ${s} is EXPIRED — upload current pricing`, href: "/library/sheets" });

  const e = input.estimate;
  if (!e) {
    b.push({ severity: "blocks_number", message: "No estimate yet", href: `${p}#estimates` });
  } else {
    const ep = `${p}/estimates/${e.id}`;
    for (const l of e.lines) {
      const st = l.sheetStatus === "EXPIRED" ? "SHEET_EXPIRED" : l.sourceStatus;
      if (HARD_LINE.has(st)) b.push({ severity: "blocks_number", message: `${e.name}: ${l.itemName} — ${LABEL[st]}`, href: `${ep}#line-${l.id}` });
      else if (SOFT_LINE.has(st)) b.push({ severity: "assumption", message: `${e.name}: ${l.itemName} — ${LABEL[st]}`, href: `${ep}#line-${l.id}` });
    }
    if (!e.labor.length) b.push({ severity: "blocks_number", message: `${e.name}: no labor lines`, href: `${ep}#labor` });
    for (const l of e.labor) {
      if (l.sourceStatus === "MISSING" || l.sourceStatus === "PENDING_AI")
        b.push({ severity: "blocks_number", message: `${e.name}: labor "${l.task}" — ${LABEL[l.sourceStatus]}`, href: `${ep}#labor` });
      else if (SOFT_LINE.has(l.sourceStatus))
        b.push({ severity: "assumption", message: `${e.name}: labor "${l.task}" — ${LABEL[l.sourceStatus]}`, href: `${ep}#labor` });
    }
    if (!e.wasteApproved) b.push({ severity: "assumption", message: `${e.name}: waste factors not approved`, href: `${ep}#waste` });
  }

  const readiness: Readiness = b.some((x) => x.severity === "blocks_number")
    ? "NOT_READY"
    : b.length
      ? "BUDGET"
      : "BID_READY";
  return { readiness, blockers: b };
}

export const READINESS_LABEL: Record<Readiness, string> = {
  NOT_READY: "Not ready for hard bid",
  BUDGET: "Budget / ballpark",
  BID_READY: "Bid ready",
};
export const readinessVariant = (r: Readiness) => (r === "BID_READY" ? "green" : r === "BUDGET" ? "amber" : "red");
