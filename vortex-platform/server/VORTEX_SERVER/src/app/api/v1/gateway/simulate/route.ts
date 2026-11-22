import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { writeAudit } from "@/lib/vortex/audit";
import { ensureSeeded } from "@/lib/vortex/seed";
import { executeGateway, type GatewayKeyRecord } from "@/lib/vortex/gateway";

/**
 * Dashboard-side gateway console: fires a request through the REAL gateway
 * pipeline (route match → key auth → app binding → scope → rate limit →
 * target resolve → access log) without needing the plaintext key.
 * `keyId` selects a stored key; omit it to demo the 401 rejection path.
 */
export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { routeKey?: string; keyId?: string; method?: string; query?: string; attack?: boolean };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }
  const routeKey = (body.routeKey || "").trim().toLowerCase();
  if (!routeKey) return fail("routeKey is required (e.g. \"nexseva\" or \"status\")");

  let keyRecord: GatewayKeyRecord | null = null;
  if (body.keyId) {
    const key = await db.apiKey.findUnique({ where: { keyId: body.keyId } });
    if (!key) return fail("API key not found", 404);
    keyRecord = key;
  }

  // SECURITY demo: attack=true sends a WAF-visible probe (path traversal + scanner UA)
  const search = new URLSearchParams(body.query || "");
  if (body.attack) search.set("file", "../../etc/passwd");

  const started = Date.now();
  const res = await executeGateway({
    routeKey,
    method: body.method || "GET",
    search,
    keyRecord,
    sourceIp: body.attack ? "198.51.100.23" : "dashboard",
    via: "SIMULATOR",
    userAgent: body.attack ? "sqlmap/1.8 (probe)" : "vortex-dashboard/0.5",
  });
  const latencyMs = Math.max(1, Date.now() - started);

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // non-JSON body — pass through as string
  }

  if (res.status === 200) {
    await writeAudit({
      actor: user.email,
      action: "GATEWAY_REQUEST_SIMULATED",
      resource: `gateway:/api/gw/${routeKey}`,
      detail: `Simulated request returned ${res.status} in ${latencyMs}ms`,
      userId: user.id,
    });
  }

  return ok({ status: res.status, latencyMs, body: parsed });
}
