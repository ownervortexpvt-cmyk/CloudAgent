import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { writeAudit } from "@/lib/vortex/audit";
import { ensureSeeded } from "@/lib/vortex/seed";

const DIRECTIONS = ["IN", "OUT"];
const ACTIONS = ["ALLOW", "DENY"];
const PROTOCOLS = ["tcp", "udp", "icmp", "any"];

export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  const rules = await db.firewallRule.findMany({ orderBy: { priority: "asc" } });
  return ok({ rules });
}

export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: {
    name?: string;
    direction?: string;
    action?: string;
    protocol?: string;
    port?: string;
    source?: string;
    priority?: number;
  };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const name = (body.name || "").trim();
  if (!name) return fail("Rule name is required");

  const direction = body.direction || "IN";
  const action = body.action || "ALLOW";
  const protocol = body.protocol || "tcp";
  if (!DIRECTIONS.includes(direction)) return fail("Invalid direction");
  if (!ACTIONS.includes(action)) return fail("Invalid action");
  if (!PROTOCOLS.includes(protocol)) return fail("Invalid protocol");

  const port = (body.port || "").trim() || null;
  if (port && !/^\d{1,5}(-\d{1,5})?$/.test(port) && protocol !== "any") {
    return fail("Port must be a number or range like 3000-3010");
  }

  const priority = Math.min(999, Math.max(1, Math.round(body.priority || 100)));

  const rule = await db.firewallRule.create({
    data: {
      name,
      direction,
      action,
      protocol,
      port,
      source: (body.source || "0.0.0.0/0").trim(),
      priority,
      enabled: true,
    },
  });

  await writeAudit({
    actor: user.email,
    action: "FIREWALL_RULE_CREATED",
    resource: `firewall:${rule.id}`,
    detail: `${priority} ${direction} ${action} ${protocol} ${port || "any"} from ${rule.source}`,
    userId: user.id,
  });
  return ok({ rule }, 201);
}

export async function PATCH(req: Request) {
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { id?: string; enabled?: boolean; priority?: number };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }
  if (!body.id) return fail("id is required");

  const rule = await db.firewallRule.findUnique({ where: { id: body.id } });
  if (!rule) return fail("Rule not found", 404);
  if (rule.isSystem && body.enabled === false) {
    return fail("DEFAULT DENY is protected by policy (network.firewall_default_deny) and cannot be disabled", 403);
  }

  const updated = await db.firewallRule.update({
    where: { id: rule.id },
    data: {
      enabled: body.enabled !== undefined ? body.enabled : rule.enabled,
      priority:
        body.priority !== undefined && !rule.isSystem
          ? Math.min(999, Math.max(1, Math.round(body.priority)))
          : rule.priority,
    },
  });

  await writeAudit({
    actor: user.email,
    action: "FIREWALL_RULE_UPDATED",
    resource: `firewall:${rule.id}`,
    detail: `${rule.name} enabled=${updated.enabled} priority=${updated.priority}`,
    userId: user.id,
  });
  return ok({ rule: updated });
}

export async function DELETE(req: Request) {
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("id query param is required");

  const rule = await db.firewallRule.findUnique({ where: { id } });
  if (!rule) return fail("Rule not found", 404);
  if (rule.isSystem) {
    return fail("System rules (default deny) cannot be deleted", 403);
  }

  await db.firewallRule.delete({ where: { id } });
  await writeAudit({
    actor: user.email,
    action: "FIREWALL_RULE_DELETED",
    resource: `firewall:${rule.id}`,
    detail: rule.name,
    userId: user.id,
  });
  return ok({ deleted: true });
}
