import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { writeAudit } from "@/lib/vortex/audit";
import { ensureSeeded } from "@/lib/vortex/seed";
import { TARGET_TYPES, executeChecks, uptimeMap24h, checkTarget } from "@/lib/vortex/monitor";
import { shortId } from "@/lib/vortex/crypto";

/** GET /monitor — auto-runs due checks, returns targets + uptime + alerts. */
export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  const origin = new URL(req.url).origin;
  await executeChecks(origin); // respects per-target intervals

  const [targets, uptime, checks, alerts, openAlerts] = await Promise.all([
    db.monitorTarget.findMany({ orderBy: { createdAt: "asc" } }),
    uptimeMap24h(),
    db.monitorCheck.findMany({ orderBy: { checkedAt: "desc" }, take: 300 }),
    db.alertEvent.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    db.alertEvent.count({ where: { status: "OPEN" } }),
  ]);

  return ok({
    targets: targets.map((t) => ({ ...t, uptimePct: uptime.get(t.id) ?? null })),
    checks,
    alerts,
    openAlerts,
  });
}

/** Create a monitor target; a first check runs immediately. */
export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { name?: string; targetType?: string; target?: string; intervalSec?: number };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const name = (body.name || "").trim();
  if (name.length < 3 || name.length > 60) return fail("Name must be 3-60 chars");
  const targetType = body.targetType || "URL";
  if (!TARGET_TYPES.includes(targetType)) return fail(`Invalid targetType. Allowed: ${TARGET_TYPES.join(", ")}`);
  const target = (body.target || "").trim();
  if (!target) return fail("target is required");

  if (targetType === "URL" && !/^https?:\/\/.+/.test(target) && !target.startsWith("/")) {
    return fail("URL target must start with / (internal) or http(s)://");
  }
  if (targetType === "NODE") {
    const node = await db.serverNode.findFirst({ where: { OR: [{ name: target }, { nodeId: target }] } });
    if (!node) return fail("Node not found in SERVER registry", 404);
  }
  if (targetType === "DATABASE") {
    const inst = await db.databaseInstance.findFirst({ where: { OR: [{ dbId: target }, { name: target }] } });
    if (!inst) return fail("Database not found in DATABASE registry", 404);
  }
  if (targetType === "SERVICE") {
    const svc = await db.service.findUnique({ where: { serviceKey: target } });
    if (!svc) return fail("Service not found in registry", 404);
  }

  const intervalCfg = await db.appConfig.findUnique({ where: { key: "monitor.default_interval_sec" } });
  const intervalSec = Math.round(body.intervalSec || parseInt(intervalCfg?.value || "60", 10) || 60);
  if (intervalSec < 15 || intervalSec > 3600) return fail("intervalSec must be 15-3600");

  const monitor = await db.monitorTarget.create({
    data: {
      monitorId: shortId("mon", 8),
      name,
      targetType,
      target,
      intervalSec,
      enabled: true,
      status: "PENDING",
    },
  });

  // First check right away so the UI shows a real status
  const origin = new URL(req.url).origin;
  const first = await checkTarget(origin, { ...monitor, name: monitor.name });

  await writeAudit({
    actor: user.email,
    action: "MONITOR_TARGET_CREATED",
    resource: `monitor:${monitor.monitorId}`,
    detail: `${name} → ${targetType} ${target} every ${intervalSec}s (first check: ${first.up ? "UP" : "DOWN"})`,
    userId: user.id,
  });

  return ok({ monitor, firstCheck: first }, 201);
}

/** Enable / pause / run-now for one target. */
export async function PATCH(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { id?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }
  if (!body.id || !body.action) return fail("id and action are required");

  const target = await db.monitorTarget.findUnique({ where: { monitorId: body.id } });
  if (!target) return fail("Monitor target not found", 404);

  if (body.action === "PAUSE") {
    const updated = await db.monitorTarget.update({
      where: { id: target.id },
      data: { enabled: false, status: "PAUSED" },
    });
    await writeAudit({ actor: user.email, action: "MONITOR_TARGET_PAUSED", resource: `monitor:${target.monitorId}`, detail: target.name, userId: user.id });
    return ok({ monitor: updated });
  }

  if (body.action === "ENABLE") {
    const updated = await db.monitorTarget.update({
      where: { id: target.id },
      data: { enabled: true, status: "PENDING" },
    });
    await writeAudit({ actor: user.email, action: "MONITOR_TARGET_ENABLED", resource: `monitor:${target.monitorId}`, detail: target.name, userId: user.id });
    return ok({ monitor: updated });
  }

  if (body.action === "RUN") {
    const origin = new URL(req.url).origin;
    const result = await checkTarget(origin, target);
    const updated = await db.monitorTarget.findUnique({ where: { id: target.id } });
    await writeAudit({
      actor: user.email,
      action: "MONITOR_CHECK_FORCED",
      resource: `monitor:${target.monitorId}`,
      detail: `${target.name}: ${result.up ? "UP" : "DOWN"}`,
      userId: user.id,
    });
    return ok({ monitor: updated, result });
  }

  return fail("Invalid action. Allowed: ENABLE, PAUSE, RUN");
}

/** Delete a target and its check history (alerts are kept for the record). */
export async function DELETE(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("id query param is required");
  const target = await db.monitorTarget.findUnique({ where: { monitorId: id } });
  if (!target) return fail("Monitor target not found", 404);

  await db.monitorCheck.deleteMany({ where: { targetId: target.id } });
  await db.monitorTarget.delete({ where: { id: target.id } });
  await writeAudit({
    actor: user.email,
    action: "MONITOR_TARGET_DELETED",
    resource: `monitor:${target.monitorId}`,
    detail: `${target.name} removed with its check history`,
    userId: user.id,
  });
  return ok({ deleted: true });
}
