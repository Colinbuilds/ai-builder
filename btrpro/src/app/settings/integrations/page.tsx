import { requireUser } from "@/lib/auth";
import { integrationCatalog, type IntegrationStatus } from "@/lib/integrations/catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { appName } from "@/lib/company-profile";

const VARIANT: Record<IntegrationStatus, "green" | "blue" | "amber" | "outline"> = {
  connected: "green",
  ready: "blue",
  not_configured: "amber",
  manual_only: "outline",
};

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ connected?: string }> }) {
  const user = await requireUser(["ADMIN"]);
  const { connected } = await searchParams;
  const items = await integrationCatalog(user.id);
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Every integration has a manual fallback, so {appName()} works before anything is connected. Server keys go in the host&apos;s
          environment variables; connection tokens are stored encrypted.
        </p>
      </div>
      {connected && <p className="rounded-md border p-2 text-sm">{connected === "denied" ? "Connection cancelled." : `Connected: ${connected}`}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((i) => (
          <section key={i.key} className="flex flex-col gap-2 rounded-md border p-4 text-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">{i.name}</h2>
              <Badge variant={VARIANT[i.status]}>{i.statusText}</Badge>
            </div>
            <p>{i.does}</p>
            <div className="text-xs text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">Needs:</span> {i.needs.join(" · ")}
              </div>
              <div>
                <span className="font-medium text-foreground">Until then:</span> {i.fallback}
              </div>
              {i.note && <div className="mt-1">{i.note}</div>}
            </div>
            {i.connectUrl && (
              <Button asChild size="sm" className="self-start">
                <a href={i.connectUrl}>Connect</a>
              </Button>
            )}
          </section>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">OAuth redirect URLs to register: {`${process.env.APP_URL ?? "<APP_URL>"}/api/integrations/{google_drive,quickbooks,procore}/callback`} and {`${process.env.APP_URL ?? "<APP_URL>"}/api/mail/{google,microsoft}/callback`}</p>
    </div>
  );
}
