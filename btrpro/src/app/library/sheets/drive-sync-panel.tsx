"use client";

import { useFormAction } from "@/components/use-form-action";
import { saveSheetFolderAction, syncSheetsNowAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";
import { useBrand } from "@/components/brand";

export function DriveSyncPanel({ folder, connected, lastCheck, serviceAccount }: { folder: string | null; connected: boolean; lastCheck: string | null; serviceAccount: string | null }) {
  const { productName: app } = useBrand();
  const [state, action, pending] = useFormAction(saveSheetFolderAction, null);
  const [sState, sAction, sPending] = useFormAction(syncSheetsNowAction, null);
  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={action} className="flex flex-wrap items-center gap-2">
        <Input name="folder" defaultValue={folder ?? ""} placeholder="Google Drive folder link — the &quot;Current&quot; price sheets folder" className="min-w-96 flex-1" />
        <Button size="sm" variant="outline" disabled={pending}>
          Save folder
        </Button>
      </form>
      {state?.ok && <p className="text-sm text-green-700 dark:text-green-400">{state.note}</p>}
      <Problems state={state} />
      {serviceAccount ? (
        <p className="text-xs text-muted-foreground">
          {app} reads Drive as <span className="font-mono">{serviceAccount}</span>. Share the price-sheet folder (or its shared drive) with that address as a Viewer.
        </p>
      ) : !connected ? (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Drive isn&apos;t set up for the app. Add a Google service account key (GOOGLE_SERVICE_ACCOUNT_JSON) on the server, or <a href="/settings/integrations" className="underline">connect your Google Drive</a>, then save the folder.
        </p>
      ) : null}
      {folder && (
        <form onSubmit={sAction} className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={sPending}>
            {sPending ? "Checking Drive…" : "Check now"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {lastCheck ? `Last checked ${new Date(lastCheck).toLocaleString("en-US", { timeZone: "America/Chicago" })}` : "Not checked yet"} · checks on start and every 6 hours
          </span>
        </form>
      )}
      {sState?.ok && <p className="text-sm">{sState.note}</p>}
      <Problems state={sState} />
    </div>
  );
}
