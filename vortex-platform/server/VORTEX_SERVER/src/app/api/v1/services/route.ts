import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { writeAudit } from "@/lib/vortex/audit";
import { ensureSeeded } from "@/lib/vortex/seed";

export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  const services = await db.service.findMany({
    orderBy: [{ phase: "asc" }, { serviceKey: "asc" }],
  });
  return ok({ services });
}

const VALID_STATUS = ["ONLINE", "OFFLINE", "DEGRADED", "BUILDING", "PLANNED", "RESERVED"];

export async function POST(req: Request) {
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { serviceKey?: string; name?: string; description?: string; phase?: number; endpoint?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const serviceKey = (body.serviceKey || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const name = (body.name || "").trim();
  if (!serviceKey || !name) return fail("serviceKey and name are required");

  const exists = await db.service.findUnique({ where: { serviceKey } });
  if (exists) return fail("A service with this key already exists", 409);

  const service = await db.service.create({
    data: {
      serviceKey,
      name,
      description: (body.description || "").trim(),
      phase: Math.max(1, Math.min(7, body.phase || 6)),
      status: "BUILDING",
      endpoint: body.endpoint?.trim() || null,
    },
  });

  await writeAudit({
    actor: user.email,
    action: "SERVICE_REGISTERED",
    resource: `service:${serviceKey}`,
    detail: name,
    userId: user.id,
  });

  return ok({ service }, 201);
}

export async function PATCH(req: Request) {
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { id?: string; status?: string; endpoint?: string; description?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  if (!body.id) return fail("Service id is required");
  const service = await db.service.findUnique({ where: { id: body.id } });
  if (!service) return fail("Service not found", 404);

  if (service.status === "RESERVED") {
    return fail("This module is RESERVED for Phase 7 (Firebase Mode) and cannot be modified", 403);
  }
  if (body.status && !VALID_STATUS.includes(body.status)) {
    return fail(`Invalid status. Allowed: ${VALID_STATUS.join(", ")}`);
  }

  const updated = await db.service.update({
    where: { id: service.id },
    data: {
      status: body.status ?? service.status,
      endpoint: body.endpoint !== undefined ? body.endpoint.trim() || null : service.endpoint,
      description: body.description !== undefined ? body.description : service.description,
    },
  });

  await writeAudit({
    actor: user.email,
    action: "SERVICE_UPDATED",
    resource: `service:${service.serviceKey}`,
    detail: `status=${updated.status}`,
    userId: user.id,
  });

  return ok({ service: updated });
}
