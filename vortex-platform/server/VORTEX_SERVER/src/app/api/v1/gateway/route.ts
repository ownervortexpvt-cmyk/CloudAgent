import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { writeAudit } from "@/lib/vortex/audit";
import { ensureSeeded } from "@/lib/vortex/seed";
import { newRouteId } from "@/lib/vortex/gateway";

const TARGET_TYPES = ["APP", "SERVICE", "MOCK"];
const SCOPES = ["read", "write", "admin", "none"];

export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  const since24h = new Date(Date.now() - 24 * 3600_000);
  const [routes, requests] = await Promise.all([
    db.gatewayRoute.findMany({ orderBy: { createdAt: "asc" }, include: { app: { select: { name: true, appId: true } } } }),
    db.gatewayRequest.findMany({ where: { createdAt: { gte: since24h } }, orderBy: { createdAt: "desc" }, take: 400 }),
  ]);

  const okCount = requests.filter((r) => r.status < 400).length;
  const blocked = requests.filter((r) => r.status >= 400).length;
  const latencies = requests.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.floor(latencies.length * 0.95) - 1);
  const p95 = latencies.length ? latencies[p95Index] : 0;

  // hourly buckets for the last 24h
  const hourly: { hour: string; count: number; blocked: number }[] = [];
  for (let i = 23; i >= 0; i--) {
    const from = new Date(Date.now() - (i + 1) * 3600_000);
    const to = new Date(Date.now() - i * 3600_000);
    const inBucket = requests.filter((r) => r.createdAt >= from && r.createdAt < to);
    hourly.push({
      hour: `${String(to.getHours()).padStart(2, "0")}:00`,
      count: inBucket.length,
      blocked: inBucket.filter((r) => r.status >= 400).length,
    });
  }

  return ok({
    routes,
    requests: requests.slice(0, 120),
    stats: {
      routesTotal: routes.length,
      routesActive: routes.filter((r) => r.status === "ACTIVE").length,
      requests24h: requests.length,
      ok24h: okCount,
      blocked24h: blocked,
      okRate: requests.length ? Math.round((okCount / requests.length) * 100) : 100,
      avgLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
      p95LatencyMs: p95,
      hourly,
    },
  });
}

export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: {
    name?: string;
    publicPath?: string;
    targetType?: string;
    target?: string;
    auth?: string;
    requiredScope?: string;
    rateLimitPerMin?: number;
    appId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const name = (body.name || "").trim();
  if (name.length < 3 || name.length > 60) return fail("Route name must be 3-60 chars");

  const publicPath = (body.publicPath || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(publicPath)) {
    return fail("Public path must be 2-31 chars: lowercase letters, digits, dashes (it becomes /api/gw/<path>)");
  }
  const exists = await db.gatewayRoute.findUnique({ where: { publicPath } });
  if (exists) return fail(`/api/gw/${publicPath} is already taken`, 409);

  const targetType = body.targetType || "APP";
  if (!TARGET_TYPES.includes(targetType)) return fail(`targetType must be one of ${TARGET_TYPES.join(", ")}`);

  let appId: string | null = null;
  let target = (body.target || "").trim();
  if (targetType === "APP") {
    if (!body.appId) return fail("appId is required for APP routes — every route serves one app (data gravity)");
    const app = await db.app.findUnique({ where: { id: body.appId } });
    if (!app) return fail("App not found", 404);
    appId = app.id;
    target = app.appId;
  } else if (targetType === "SERVICE") {
    const svc = await db.service.findUnique({ where: { serviceKey: target } });
    if (!svc) return fail(`Service "${target}" not found in the registry`, 404);
  } else {
    target = "echo";
  }

  const auth = body.auth === "PUBLIC" ? "PUBLIC" : "API_KEY";
  const requiredScope = auth === "PUBLIC" ? "none" : SCOPES.includes(body.requiredScope || "read") ? body.requiredScope! : "read";
  const rateLimitPerMin = Math.min(10_000, Math.max(10, Math.round(body.rateLimitPerMin || 120)));

  const route = await db.gatewayRoute.create({
    data: {
      routeId: newRouteId(),
      name,
      publicPath,
      targetType,
      target,
      auth,
      requiredScope,
      rateLimitPerMin,
      appId,
      status: "ACTIVE",
      createdBy: user.email,
    },
  });

  await writeAudit({
    actor: user.email,
    action: "GATEWAY_ROUTE_CREATED",
    resource: `gateway:${route.routeId}`,
    detail: `/api/gw/${publicPath} → ${targetType}:${target} · auth=${auth}${auth === "API_KEY" ? ` scope=${requiredScope}` : ""} · ${rateLimitPerMin}/min`,
    userId: user.id,
  });

  return ok({ route }, 201);
}

export async function PATCH(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { id?: string; status?: string; rateLimitPerMin?: number; requiredScope?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }
  if (!body.id) return fail("id is required");

  const route = await db.gatewayRoute.findUnique({ where: { id: body.id } });
  if (!route) return fail("Route not found", 404);

  const data: Record<string, unknown> = {};
  if (body.status) {
    if (!["ACTIVE", "DISABLED"].includes(body.status)) return fail("status must be ACTIVE or DISABLED");
    data.status = body.status;
  }
  if (body.rateLimitPerMin !== undefined) {
    data.rateLimitPerMin = Math.min(10_000, Math.max(10, Math.round(body.rateLimitPerMin)));
  }
  if (body.requiredScope && route.auth === "API_KEY") {
    if (!SCOPES.includes(body.requiredScope)) return fail(`scope must be one of ${SCOPES.join(", ")}`);
    data.requiredScope = body.requiredScope;
  }
  if (Object.keys(data).length === 0) return fail("Nothing to update");

  const updated = await db.gatewayRoute.update({ where: { id: route.id }, data });

  await writeAudit({
    actor: user.email,
    action: "GATEWAY_ROUTE_UPDATED",
    resource: `gateway:${route.routeId}`,
    detail: `/api/gw/${route.publicPath}: ${JSON.stringify(data)}`,
    userId: user.id,
  });

  return ok({ route: updated });
}

export async function DELETE(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("id query param is required");
  const route = await db.gatewayRoute.findUnique({ where: { id } });
  if (!route) return fail("Route not found", 404);

  await db.gatewayRoute.delete({ where: { id: route.id } });
  await writeAudit({
    actor: user.email,
    action: "GATEWAY_ROUTE_DELETED",
    resource: `gateway:${route.routeId}`,
    detail: `/api/gw/${route.publicPath} removed from the edge`,
    userId: user.id,
  });
  return ok({ deleted: true });
}
