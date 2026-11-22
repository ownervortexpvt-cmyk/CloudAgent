import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sha256, shortId } from "./crypto";
import { rateLimit } from "./ratelimit";
import { edgeSecurityCheck, noteRateAbuse } from "./security";

/**
 * VORTEX API GATEWAY — the one door every app call walks through (Phase 4+5).
 *
 * Pipeline (shared by the real edge /api/gw/* and the dashboard simulator):
 *   SECURITY (IP blocklist → WAF) → match route → status → auth
 *   (API key | public) → app binding → scope → rate limit → resolve
 *   target payload → access log (always). Rate-limit abuse feeds the
 *   SECURITY DDoS shield (auto-block).
 *
 * Data gravity: a key bound to app A can never call app B's route.
 */

export type GatewayKeyRecord = {
  id: string;
  keyId: string;
  prefix: string;
  scopes: string;
  status: string;
  appId: string | null;
};

export type GatewayExecuteInput = {
  routeKey: string;
  method: string;
  search?: URLSearchParams;
  body?: unknown;
  rawKey?: string; // Bearer plaintext from the edge
  keyRecord?: GatewayKeyRecord | null; // simulator passes the record directly
  sourceIp?: string;
  via?: "EDGE" | "SIMULATOR";
  userAgent?: string | null; // SECURITY WAF input (edge passes it through)
  extraHeaders?: Record<string, string>; // SECURITY WAF input (named headers)
};

export type GatewayOutcome = {
  status: number;
  envelope: Record<string, unknown>;
  log: {
    routeId: string | null;
    routeKey: string;
    method: string;
    status: number;
    latencyMs: number;
    keyPrefix: string | null;
    appId: string | null;
    sourceIp: string;
    via: string;
    blocked: string | null;
  };
};

function gwError(status: number, error: string, blocked: string): GatewayOutcome {
  return { status, envelope: { ok: false, error }, log: { routeId: null, routeKey: "", method: "GET", status, latencyMs: 0, keyPrefix: null, appId: null, sourceIp: "local", via: "EDGE", blocked } };
}

/** Resolve the JSON payload the gateway serves for a matched route. */
async function resolvePayload(
  route: { targetType: string; target: string; publicPath: string },
  subPath: string,
  method: string,
  search?: URLSearchParams,
  body?: unknown
): Promise<Record<string, unknown>> {
  if (route.targetType === "MOCK") {
    return {
      echo: true,
      route: route.publicPath,
      subPath,
      method,
      query: Object.fromEntries(search?.entries() || []),
      body: body ?? null,
    };
  }

  if (route.targetType === "SERVICE") {
    const svc = await db.service.findUnique({ where: { serviceKey: route.target } });
    if (!svc) return { error: `upstream service "${route.target}" not found in registry` };

    if (svc.serviceKey === "core") {
      const [online, total] = await Promise.all([
        db.service.count({ where: { status: "ONLINE" } }),
        db.service.count(),
      ]);
      return { service: svc.name, status: svc.status, registry: { online, total }, version: svc.version };
    }
    if (svc.serviceKey === "database") {
      const instances = await db.databaseInstance.findMany({ where: { status: { not: "DESTROYED" } }, select: { engine: true, status: true } });
      return {
        service: svc.name,
        status: svc.status,
        engines: instances.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.engine]: (acc[i.engine] || 0) + 1 }), {}),
        running: instances.filter((i) => i.status === "RUNNING").length,
      };
    }
    if (svc.serviceKey === "storage") {
      const buckets = await db.storageBucket.aggregate({ _count: true, _sum: { usedMb: true } });
      return { service: svc.name, status: svc.status, buckets: buckets._count, usedMb: buckets._sum.usedMb || 0, replication: 3 };
    }
    return { service: svc.name, status: svc.status, endpoint: svc.endpoint, version: svc.version };
  }

  // APP target — the app's own slice of the platform (data gravity in action)
  const app = await db.app.findUnique({ where: { appId: route.target } });
  if (!app) return { error: `app "${route.target}" not found` };
  const [keys, dbs, buckets, files] = await Promise.all([
    db.apiKey.count({ where: { appId: app.id, status: "ACTIVE" } }),
    db.databaseInstance.count({ where: { appId: app.id, status: { not: "DESTROYED" } } }),
    db.storageBucket.count({ where: { appId: app.id } }),
    db.fileObject.count({ where: { appId: app.id, status: "ACTIVE" } }),
  ]);
  return {
    app: app.appId,
    name: app.name,
    status: app.status,
    subPath,
    resources: { activeKeys: keys, databases: dbs, storageBuckets: buckets, files },
  };
}

/**
 * Run one request through the full gateway pipeline and log it.
 * Returns the NextResponse to send to the caller.
 */
export async function executeGateway(input: GatewayExecuteInput): Promise<NextResponse> {
  const started = Date.now();
  const via = input.via || "EDGE";
  const sourceIp = input.sourceIp || "local";
  const method = (input.method || "GET").toUpperCase();
  const routeKey = input.routeKey.toLowerCase();

  const finish = async (outcome: GatewayOutcome, extraRouteId?: string, extraAppId?: string | null, keyPrefix?: string | null): Promise<NextResponse> => {
    const latencyMs = Math.max(1, Date.now() - started);
    const log = {
      ...outcome.log,
      routeId: extraRouteId ?? outcome.log.routeId,
      routeKey,
      method,
      latencyMs,
      keyPrefix: keyPrefix ?? outcome.log.keyPrefix,
      appId: extraAppId ?? outcome.log.appId,
      sourceIp,
      via,
    };
    await db.gatewayRequest.create({
      data: {
        routeId: log.routeId,
        routeKey: log.routeKey,
        method: log.method,
        status: log.status,
        latencyMs,
        keyPrefix: log.keyPrefix,
        appId: log.appId,
        sourceIp: log.sourceIp,
        via,
        blocked: log.blocked,
      },
    });
    if (log.status < 400 && log.routeId) {
      await db.gatewayRoute.update({
        where: { id: log.routeId },
        data: { hitCount: { increment: 1 }, lastHitAt: new Date() },
      });
    }
    return NextResponse.json(outcome.envelope, { status: outcome.status });
  };

  const route = await db.gatewayRoute.findUnique({ where: { publicPath: routeKey } });

  // ---- SECURITY (Phase 5): IP blocklist → WAF, before anything else ----
  const secCheck = await edgeSecurityCheck({
    path: "",
    query: input.search?.toString(),
    body: input.body,
    userAgent: input.userAgent ?? null,
    headers: input.extraHeaders ?? {},
    sourceIp,
    routeKey: route?.publicPath ?? routeKey,
    appId: route?.appId ?? null,
  });
  if (secCheck.blocked) {
    return finish(gwError(403, secCheck.reason || "Blocked by SECURITY", "security: waf/blocklist"), route?.id, route?.appId);
  }

  if (!route) {
    return finish(gwError(404, `No gateway route at /api/gw/${routeKey}`, "no route matched"));
  }
  if (route.status !== "ACTIVE") {
    return finish(gwError(503, `Route ${route.publicPath} is ${route.status.toLowerCase()}`, "route disabled"), route.id, route.appId);
  }

  // ---- auth ----
  let key: GatewayKeyRecord | null = null;
  let keyPrefix: string | null = null;

  if (route.auth === "API_KEY") {
    if (input.keyRecord) {
      key = input.keyRecord;
    } else if (input.rawKey) {
      const found = await db.apiKey.findUnique({ where: { keyHash: sha256(input.rawKey) } });
      key = found
        ? { id: found.id, keyId: found.keyId, prefix: found.prefix, scopes: found.scopes, status: found.status, appId: found.appId }
        : null;
    }
    if (!key) {
      return finish(gwError(401, "Missing or invalid API key — send Authorization: Bearer vx_live_...", "no/invalid key"), route.id, route.appId);
    }
    keyPrefix = key.prefix;
    if (key.status !== "ACTIVE") {
      return finish(gwError(401, "This API key has been revoked", "key revoked"), route.id, route.appId, keyPrefix);
    }
    // Data gravity: keys are app-scoped — a key cannot cross into another app's route
    if (route.appId && key.appId !== route.appId) {
      return finish(gwError(403, "Key is bound to a different app — routes are app-scoped by design", "key/app mismatch"), route.id, route.appId, keyPrefix);
    }
    const scopes = key.scopes.split(",").map((s) => s.trim());
    if (route.requiredScope && !scopes.includes(route.requiredScope)) {
      return finish(gwError(403, `Key lacks the required scope "${route.requiredScope}"`, "scope missing"), route.id, route.appId, keyPrefix);
    }
  }

  // ---- rate limit (per route + key identity) ----
  const rlIdentity = key ? key.id : sourceIp;
  const rl = rateLimit(`gw:${route.id}:${rlIdentity}`, route.rateLimitPerMin, 60_000);
  if (!rl.allowed) {
    // SECURITY DDoS shield: repeated 429s auto-block the source IP
    try {
      await noteRateAbuse(sourceIp, route.publicPath);
    } catch {
      // shield must never take the edge down
    }
    return finish(gwError(429, `Rate limit exceeded (${route.rateLimitPerMin}/min) — retry in ${rl.retryAfterSec}s`, "rate limited"), route.id, route.appId, keyPrefix);
  }

  // ---- resolve payload ----
  const search = input.search ?? new URLSearchParams();
  const body = input.body;
  let payload: Record<string, unknown>;
  try {
    payload = await resolvePayload(route, "", method, search, body);
  } catch {
    return finish(gwError(502, "Upstream target failed to resolve", "upstream error"), route.id, route.appId, keyPrefix);
  }

  const envelope = {
    ok: true,
    data: {
      payload,
      meta: {
        route: { routeId: route.routeId, path: route.publicPath, name: route.name },
        key: keyPrefix,
        rateRemaining: rl.remaining,
        via,
      },
    },
  };

  return finish(
    {
      status: 200,
      envelope,
      log: { routeId: route.id, routeKey, method, status: 200, latencyMs: 0, keyPrefix, appId: route.appId, sourceIp, via, blocked: null },
    },
    route.id,
    route.appId,
    keyPrefix
  );
}

export function newRouteId(): string {
  return shortId("gw", 8);
}
