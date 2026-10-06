// Is a buildout up? Fetches its sign-in page (every deployment serves /login without a session), over the
// Railway private network when an internal address is set, else the public one.
export type Check = { ok: boolean; ms: number | null; error: string | null };

export async function checkBuildout(b: { url: string | null; internalUrl: string | null }, fetcher: typeof fetch = fetch): Promise<Check> {
  const base = (b.internalUrl || b.url || "").replace(/\/+$/, "");
  if (!base) return { ok: false, ms: null, error: "No address set." };
  const started = Date.now();
  try {
    const res = await fetcher(`${base}/login`, { redirect: "manual", signal: AbortSignal.timeout(10_000), cache: "no-store" });
    const ms = Date.now() - started;
    return res.status >= 200 && res.status < 400 ? { ok: true, ms, error: null } : { ok: false, ms, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, ms: null, error: e instanceof Error ? e.message.slice(0, 200) : String(e) };
  }
}
