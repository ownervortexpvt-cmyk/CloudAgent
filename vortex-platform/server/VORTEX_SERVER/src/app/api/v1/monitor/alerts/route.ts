import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { writeAudit } from "@/lib/vortex/audit";
import { ensureSeeded } from "@/lib/vortex/seed";

/** GET /monitor/alerts — alert feed + open count. */
export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  const [alerts, open] = await Promise.all([
    db.alertEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    db.alertEvent.count({ where: { status: "OPEN" } }),
  ]);
  return ok({ alerts, open });
}

/** PATCH /monitor/alerts — ACK or RESOLVE an alert. */
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
  if (!body.id || !["ACK", "RESOLVE"].includes(body.action || "")) {
    return fail("id and action (ACK | RESOLVE) are required");
  }

  const alert = await db.alertEvent.findUnique({ where: { id: body.id } });
  if (!alert) return fail("Alert not found", 404);
  if (alert.status === "RESOLVED") return fail("Alert already resolved");

  const status = body.action === "ACK" ? "ACK" : "RESOLVED";
  const updated = await db.alertEvent.update({
    where: { id: alert.id },
    data: { status, ackBy: user.email, ackAt: new Date() },
  });

  await writeAudit({
    actor: user.email,
    action: `ALERT_${status}`,
    resource: `alert:${alert.id}`,
    detail: alert.message,
    userId: user.id,
  });

  return ok({ alert: updated });
}
