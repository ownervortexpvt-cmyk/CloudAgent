import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { writeAudit } from "@/lib/vortex/audit";
import { ensureSeeded } from "@/lib/vortex/seed";
import { allocatePrivateIp, releaseIpsForNode, newServerNodeId } from "@/lib/vortex/network";

const ROLES = ["CONTROL_PLANE", "APP_RUNTIME", "STORAGE", "DATABASE", "GATEWAY"];
const HOST_TYPES = ["KVM", "CONTAINER", "BARE_METAL"];
const VALID_TRANSITIONS: Record<string, string[]> = {
  PROVISIONING: ["RUNNING", "ERROR"],
  RUNNING: ["STOPPED", "ERROR"],
  STOPPED: ["RUNNING", "DESTROYED"],
  ERROR: ["STOPPED", "DESTROYED"],
};

export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  // Simulated provisioning: nodes flip to RUNNING ~3s after creation
  const stale = new Date(Date.now() - 3_000);
  await db.serverNode.updateMany({
    where: { status: "PROVISIONING", createdAt: { lt: stale } },
    data: { status: "RUNNING", uptimeSince: new Date() },
  });

  const nodes = await db.serverNode.findMany({
    orderBy: { createdAt: "desc" },
    include: { app: { select: { name: true, appId: true } } },
  });
  return ok({ nodes });
}

/**
 * Provision a new node. If allocateIp is true, NETWORK auto-assigns the first
 * free private IP — SERVER and NETWORK modules working together.
 */
export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: {
    name?: string;
    role?: string;
    hostType?: string;
    cpuCores?: number;
    ramMb?: number;
    diskGb?: number;
    appId?: string | null;
    allocateIp?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const name = (body.name || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,30}$/.test(name)) {
    return fail("Node name must be 3-31 chars: lowercase letters, digits, dashes");
  }
  const exists = await db.serverNode.findUnique({ where: { name } });
  if (exists && exists.status !== "DESTROYED") {
    return fail("A node with this name already exists", 409);
  }

  const role = body.role || "APP_RUNTIME";
  if (!ROLES.includes(role)) return fail(`Invalid role. Allowed: ${ROLES.join(", ")}`);
  const hostType = body.hostType || "KVM";
  if (!HOST_TYPES.includes(hostType)) return fail(`Invalid hostType. Allowed: ${HOST_TYPES.join(", ")}`);

  const cpu = Math.round(body.cpuCores || 1);
  const ram = Math.round(body.ramMb || 1024);
  const disk = Math.round(body.diskGb || 20);
  if (cpu < 1 || cpu > 64) return fail("cpuCores must be 1-64");
  if (ram < 256 || ram > 262144) return fail("ramMb must be 256-262144");
  if (disk < 10 || disk > 40960) return fail("diskGb must be 10-40960");

  // Per-app quota (ADMIN quotas groundwork)
  let appId: string | null = null;
  if (body.appId) {
    const app = await db.app.findUnique({ where: { id: body.appId } });
    if (!app) return fail("App not found", 404);
    appId = app.id;
    const quotaCfg = await db.appConfig.findUnique({ where: { key: "server.max_per_app" } });
    const max = parseInt(quotaCfg?.value || "10", 10) || 10;
    const count = await db.serverNode.count({ where: { appId: app.id, status: { not: "DESTROYED" } } });
    if (count >= max) {
      return fail(`Quota exceeded: ${app.name} already has ${count}/${max} nodes`, 429);
    }
  }

  const nodeId = newServerNodeId();
  let ipAddress: string | null = null;
  if (body.allocateIp !== false) {
    ipAddress = await allocatePrivateIp(nodeId);
  }

  const node = await db.serverNode.create({
    data: {
      nodeId,
      name,
      role,
      hostType,
      status: "PROVISIONING",
      cpuCores: cpu,
      ramMb: ram,
      diskGb: disk,
      ipAddress,
      osImage: (await db.appConfig.findUnique({ where: { key: "server.default_os" } }))?.value || "debian-12",
      region: "dhaka-1",
      appId,
      provisionedBy: user.email,
    },
  });

  await writeAudit({
    actor: user.email,
    action: "SERVER_PROVISIONED",
    resource: `server:${nodeId}`,
    detail: `${name} ${role} ${cpu}c/${ram}MB/${disk}GB ip=${ipAddress || "none"} app=${body.appId || "none"}`,
    userId: user.id,
  });

  return ok({ node }, 201);
}

export async function PATCH(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { id?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }
  if (!body.id || !body.status) return fail("id and status are required");

  const node = await db.serverNode.findUnique({ where: { id: body.id } });
  if (!node) return fail("Node not found", 404);
  if (node.status === "DESTROYED") return fail("Node already destroyed");

  const target = body.status;
  if (!["RUNNING", "STOPPED", "DESTROYED"].includes(target)) {
    return fail("Invalid target status");
  }
  if (node.role === "CONTROL_PLANE" && target === "DESTROYED") {
    return fail("The control plane node cannot be destroyed", 403);
  }

  if (!VALID_TRANSITIONS[node.status]?.includes(target)) {
    return fail(`Cannot go ${node.status} → ${target}`);
  }

  const data: Record<string, unknown> = { status: target };
  if (target === "RUNNING") data.uptimeSince = new Date();
  if (target === "DESTROYED") {
    const released = await releaseIpsForNode(node.nodeId);
    data.ipAddress = null;
    data.uptimeSince = null;
    await writeAudit({
      actor: user.email,
      action: "SERVER_DESTROYED",
      resource: `server:${node.nodeId}`,
      detail: `${node.name} destroyed, ${released} IP(s) released`,
      userId: user.id,
    });
  } else {
    await writeAudit({
      actor: user.email,
      action: target === "RUNNING" ? "SERVER_STARTED" : "SERVER_STOPPED",
      resource: `server:${node.nodeId}`,
      detail: node.name,
      userId: user.id,
    });
  }

  const updated = await db.serverNode.update({ where: { id: node.id }, data });
  return ok({ node: updated });
}
