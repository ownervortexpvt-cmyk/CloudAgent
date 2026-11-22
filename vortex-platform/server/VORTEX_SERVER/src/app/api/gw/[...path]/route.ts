import { ensureSeeded } from "@/lib/vortex/seed";
import { executeGateway } from "@/lib/vortex/gateway";
import { getClientIp } from "@/lib/vortex/ratelimit";

/**
 * VORTEX PUBLIC EDGE — /api/gw/<route>/...
 *
 * This is the only door apps get. Every request walks the real pipeline:
 *   SECURITY (IP blocklist → WAF) → route match → key auth → app binding
 *   → scope → rate limit → target → access log.
 *
 *   curl -H "Authorization: Bearer vx_live_..." http://host:3000/api/gw/nexseva
 *   curl http://host:3000/api/gw/status          (public probe)
 */
async function handle(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  await ensureSeeded();
  const { path } = await ctx.params;
  const routeKey = path?.[0] || "";
  const url = new URL(req.url);

  let body: unknown = undefined;
  if (!["GET", "HEAD"].includes(req.method)) {
    try {
      body = await req.json();
    } catch {
      body = null;
    }
  }

  const header = req.headers.get("authorization") || "";
  const rawKey = header.startsWith("Bearer ") ? header.slice(7).trim() : undefined;

  // SECURITY (Phase 5) WAF inputs
  const extraHeaders: Record<string, string> = {};
  req.headers.forEach((value, name) => {
    if (name !== "authorization" && name !== "cookie") extraHeaders[name] = value;
  });

  return executeGateway({
    routeKey,
    method: req.method,
    search: url.searchParams,
    body,
    rawKey,
    sourceIp: getClientIp(req),
    via: "EDGE",
    userAgent: req.headers.get("user-agent"),
    extraHeaders,
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
