"use client";

import { useState, useTransition } from "react";
import type { ParsedHeader, ParsedRow } from "@/lib/sheets/parse";
import { UOMS } from "@/lib/sheets/parse";
import { diffSheet, validateRows, type DiffItem } from "@/lib/sheets/diff";
import { accountWarning } from "@/lib/company";
import { applyReviewedImport } from "../../actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatUsd } from "@/lib/utils";

type Row = ParsedRow & { key: number; priceText: string };
type Filter = "all" | "changes" | "wrapped";

const toRow = (r: ParsedRow, key: number): Row => ({
  ...r,
  key,
  priceText: r.priceStatus === "CALL" ? "CALL" : String(r.unitPrice ?? ""),
});

export function ReviewGrid(props: {
  importId: string;
  initialName: string;
  initialScope: string;
  initialHeader: ParsedHeader;
  initialRows: ParsedRow[];
  unparsed: { line: number; text: string }[];
  oldItems: DiffItem[];
  own?: { shortName: string; abcAccount: string };
}) {
  const [name, setName] = useState(props.initialName);
  const [scope, setScope] = useState(props.initialScope);
  const [header, setHeader] = useState(props.initialHeader);
  const [rows, setRows] = useState<Row[]>(() => props.initialRows.map(toRow));
  const [nextKey, setNextKey] = useState(props.initialRows.length);
  const [filter, setFilter] = useState<Filter>("all");
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const clean = rows.map(({ key: _k, priceText: _p, ...r }) => r);
  const diff = diffSheet(props.oldItems, clean);
  const changedBy = new Map(diff.changed.map((c) => [c.itemNumber, c]));
  const addedSet = new Set(diff.added.map((a) => a.itemNumber));
  const problems = validateRows(clean, UOMS);
  const warning = accountWarning(header.account, props.own);

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const setPrice = (key: number, text: string) => {
    const call = /^call/i.test(text.trim());
    const n = Number(text.replace(/[$,\s]/g, ""));
    update(key, {
      priceText: text,
      priceStatus: call ? "CALL" : "LISTED",
      unitPrice: call || text.trim() === "" || !Number.isFinite(n) ? null : n,
    });
  };

  const shown = rows.filter((r) =>
    filter === "all" ? true : filter === "wrapped" ? r.wrapped : addedSet.has(r.itemNumber) || changedBy.has(r.itemNumber),
  );

  const apply = () =>
    start(async () => {
      const res = await applyReviewedImport(props.importId, { name, scope, header, rows: clean });
      setErrors(res ?? []);
      if (res?.length) window.scrollTo({ top: 0, behavior: "smooth" });
    });

  return (
    <div className="flex flex-col gap-5">
      {errors.length > 0 && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <p className="font-semibold">Fix these before applying:</p>
          <ul className="list-disc pl-5">
            {errors.slice(0, 20).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="grid gap-3 rounded-md border p-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label>Sheet name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Covers</Label>
          <Input value={scope} onChange={(e) => setScope(e.target.value)} />
        </div>
        {(
          [
            ["effective", "Effective date", "date"],
            ["expiration", "Expiration date", "date"],
            ["account", "Account", "text"],
            ["salesRep", "Sales rep", "text"],
          ] as const
        ).map(([k, label, type]) => (
          <div key={k} className="flex flex-col gap-1">
            <Label>
              {label} {!header[k] && <Badge variant="red">MISSING</Badge>}
            </Label>
            <Input type={type} value={header[k] ?? ""} onChange={(e) => setHeader({ ...header, [k]: e.target.value || null })} />
          </div>
        ))}
        {warning && (
          <Badge variant="amber" className="whitespace-normal sm:col-span-3">
            {warning}
          </Badge>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-4">
        {[
          ["Rows", rows.length],
          ["New items", diff.added.length],
          ["Changed", diff.changed.length],
          ["Removed", diff.removed.length],
        ].map(([l, n]) => (
          <div key={l} className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">{l}</div>
            <div className="text-2xl font-semibold tabular-nums">{n}</div>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="all">All rows</option>
          <option value="changes">New and changed only</option>
          <option value="wrapped">Wrapped descriptions (check these)</option>
        </Select>
        <Button
          variant="outline"
          onClick={() => {
            setRows((rs) => [
              ...rs,
              { key: nextKey, section: "", itemNumber: "", description: "", unitPrice: null, priceStatus: "LISTED", uom: "EA", line: 0, priceText: "" },
            ]);
            setNextKey(nextKey + 1);
            setFilter("all");
          }}
        >
          Add row
        </Button>
        <span className="text-sm text-muted-foreground">
          Type CALL in the price for call-for-price items. UOMs are kept exactly as on the sheet.
        </span>
      </div>

      <Table>
        <THead>
          <TR>
            <TH>Line</TH>
            <TH>Item #</TH>
            <TH className="w-[36%]">Description</TH>
            <TH>Section</TH>
            <TH>Price</TH>
            <TH>UOM</TH>
            <TH>vs. live</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {shown.map((r) => {
            const ch = changedBy.get(r.itemNumber);
            return (
              <TR key={r.key}>
                <TD className="text-xs text-muted-foreground">{r.line || "new"}</TD>
                <TD>
                  <Input className="h-8 w-32 font-mono text-xs" value={r.itemNumber} onChange={(e) => update(r.key, { itemNumber: e.target.value })} />
                </TD>
                <TD>
                  <Input className="h-8" value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} />
                  {r.wrapped && <Badge variant="amber" className="mt-1">wrapped, check</Badge>}
                </TD>
                <TD>
                  <Input className="h-8 w-40" value={r.section} onChange={(e) => update(r.key, { section: e.target.value })} />
                </TD>
                <TD>
                  <Input className="h-8 w-24 text-right" value={r.priceText} onChange={(e) => setPrice(r.key, e.target.value)} />
                </TD>
                <TD>
                  <Select className="h-8" value={r.uom} onChange={(e) => update(r.key, { uom: e.target.value })}>
                    {!UOMS.includes(r.uom as never) && <option value={r.uom}>{r.uom || "—"}</option>}
                    {UOMS.map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </Select>
                </TD>
                <TD className="text-xs">
                  {addedSet.has(r.itemNumber) ? (
                    <Badge variant="blue">NEW</Badge>
                  ) : ch ? (
                    <div className="flex flex-col gap-0.5">
                      {ch.fields.includes("price") && (
                        <span>
                          {ch.before.unitPrice == null ? "CALL" : formatUsd(ch.before.unitPrice)} →{" "}
                          {ch.after.unitPrice == null ? "CALL" : formatUsd(ch.after.unitPrice)}
                          {ch.pctChange != null && (
                            <Badge variant={ch.pctChange > 0 ? "red" : "green"} className="ml-1">
                              {ch.pctChange > 0 ? "+" : ""}
                              {ch.pctChange}%
                            </Badge>
                          )}
                        </span>
                      )}
                      {ch.fields.includes("uom") && (
                        <Badge variant="amber">
                          UOM {ch.before.uom} → {ch.after.uom}
                        </Badge>
                      )}
                      {ch.fields.includes("description") && <span className="text-muted-foreground">was: {ch.before.description}</span>}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">same</span>
                  )}
                </TD>
                <TD>
                  <Button variant="ghost" size="sm" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                    Remove
                  </Button>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>

      {diff.removed.length > 0 && (
        <details open className="rounded-md border p-4 text-sm">
          <summary className="cursor-pointer font-semibold">
            {diff.removed.length} item{diff.removed.length === 1 ? "" : "s"} on the live sheet but not in this upload
          </summary>
          <p className="mt-1 text-muted-foreground">These will no longer be priced once you apply. Add them back if the parser missed them.</p>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {diff.removed.map((i) => (
              <li key={i.itemNumber}>
                <span className="font-mono text-xs">{i.itemNumber}</span> {i.description}
              </li>
            ))}
          </ul>
        </details>
      )}

      {props.unparsed.length > 0 && (
        <details className="rounded-md border p-4 text-sm">
          <summary className="cursor-pointer font-semibold">{props.unparsed.length} lines the parser skipped</summary>
          <p className="mt-1 text-muted-foreground">Headers and page furniture are normal here. Any price row listed here needs to be added by hand.</p>
          <ul className="mt-2 font-mono text-xs">
            {props.unparsed.map((u) => (
              <li key={u.line}>
                <span className="text-muted-foreground">{u.line}:</span> {u.text}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="sticky bottom-0 flex items-center gap-3 border-t bg-background py-3">
        <Button onClick={apply} disabled={pending}>
          {pending ? "Applying…" : "Apply as the live sheet"}
        </Button>
        {problems.length > 0 ? (
          <span className="text-sm text-destructive">
            {problems.length} row problem{problems.length === 1 ? "" : "s"}: {problems[0]}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">
            {rows.length} rows · replaces the current version, which stays in history.
          </span>
        )}
      </div>
    </div>
  );
}
