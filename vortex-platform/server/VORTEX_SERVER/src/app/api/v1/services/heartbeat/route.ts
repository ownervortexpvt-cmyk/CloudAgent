import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { ensureSeeded } from "@/lib/vortex/seed";

/**
 * Heartbeat — how a VORTEX module reports "I am alive" to CORE.
 * In production each module calls this on a schedule.
 */
export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  let body: { serviceKey?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const serviceKey = (body.serviceKey || "").trim();
  if (!serviceKey) return fail("serviceKey is required");

  const service = await db.service.findUnique({ where: { serviceKey } });
  if (!service) return fail("Unknown serviceKey", 404);
  if (service.status === "RESERVED") return fail("Reserved module cannot send heartbeats", 403);

  const updated = await db.service.update({
    where: { id: service.id },
    data: { lastHeartbeat: new Date(), status: "ONLINE" },
  });

  return ok({ serviceKey: updated.serviceKey, lastHeartbeat: updated.lastHeartbeat, status: updated.status });
}
