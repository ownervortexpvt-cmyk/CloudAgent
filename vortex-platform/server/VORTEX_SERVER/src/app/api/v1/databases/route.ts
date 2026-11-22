import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { writeAudit } from "@/lib/vortex/audit";
import { ensureSeeded } from "@/lib/vortex/seed";
import { allocatePrivateIp, releaseIpsForNode } from "@/lib/vortex/network";
import { ENGINES, DEFAULT_ENGINE_VERSION, DB_STATUS_TRANSITIONS, newDbId, dnsNameFor } from "@/lib/vortex/data";
import { generateToken, sha256 } from "@/lib/vortex/crypto";

export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  // Simulated provisioning: instances flip to RUNNING ~3s after creation
  const stale = new Date(Date.now() - 3_000);
  await db.databaseInstance.updateMany({
    where: { status: "PROVISIONING", createdAt: { lt: stale } },
    data: { status: "RUNNING" },
  });

  const databases = await db.databaseInstance.findMany({
    orderBy: { createdAt: "desc" },
    include: { app: { select: { name: true, appId: true } } },
  });
  return ok({ databases });
}

/**
 * Provision a per-app database instance.
 * Data gravity rule: appId is REQUIRED — every database lives for an app.
 * NETWORK integration: auto IP + auto DNS <name>.db.vortex.internal.
 * Credentials are shown ONCE; only the sha256 hash is stored.
 */
export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: {
    name?: string;
    engine?: string;
    version?: string;
    sizeGb?: number;
    appId?: string;
    allocateIp?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const name = (body.name || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,30}$/.test(name)) {
    return fail("Name must be 3-31 chars: lowercase letters, digits, dashes");
  }
  const exists = await db.databaseInstance.findUnique({ where: { name } });
  if (exists && exists.status !== "DESTROYED") {
    return fail("A database with this name already exists", 409);
  }

  const engine = body.engine || "POSTGRES";
  if (!ENGINES[engine]) return fail(`Invalid engine. Allowed: ${Object.keys(ENGINES).join(", ")}`);
  const version = body.version || DEFAULT_ENGINE_VERSION[engine];
  if (!ENGINES[engine].versions.includes(version)) {
    return fail(`Invalid ${engine} version. Allowed: ${ENGINES[engine].versions.join(", ")}`);
  }

  // Data gravity: an app is mandatory
  if (!body.appId) return fail("appId is required — every VORTEX database belongs to an app");
  const app = await db.app.findUnique({ where: { id: body.appId } });
  if (!app) return fail("App not found", 404);

  const quotaCfg = await db.appConfig.findUnique({ where: { key: "database.max_per_app" } });
  const max = parseInt(quotaCfg?.value || "10", 10) || 10;
  const count = await db.databaseInstance.count({
    where: { appId: app.id, status: { not: "DESTROYED" } },
  });
  if (count >= max) {
    return fail(`Quota exceeded: ${app.name} already has ${count}/${max} databases`, 429);
  }

  const sizeMb = Math.round((body.sizeGb || 10) * 1024);
  if (sizeMb < 512 || sizeMb > 4194304) return fail("sizeGb must be 0.5 - 4096");

  const dbId = newDbId();
  let ipAddress: string | null = null;
  if (body.allocateIp !== false) {
    ipAddress = await allocatePrivateIp(dbId);
  }

  // Host: first RUNNING DATABASE-role node, fallback to the seeded one
  const hostNode =
    (await db.serverNode.findFirst({ where: { role: "DATABASE", status: "RUNNING" }, orderBy: { createdAt: "asc" } })) ||
    (await db.serverNode.findUnique({ where: { name: "vortex-db-01" } }));

  const username = `vx_${name.replace(/[^a-z0-9]/g, "").slice(0, 16)}`;
  const password = generateToken(16); // shown once
  const port = ENGINES[engine].port;

  const instance = await db.databaseInstance.create({
    data: {
      dbId,
      name,
      engine,
      version,
      status: "PROVISIONING",
      sizeMb,
      host: hostNode?.name || "vortex-db-01",
      port,
      ipAddress,
      dnsName: ipAddress ? dnsNameFor(name) : null,
      username,
      secretHash: sha256(password),
      secretPrefix: `vxdb_${password.slice(0, 4)}`,
      appId: app.id,
      provisionedBy: user.email,
    },
  });

  // NETWORK DNS auto-record
  if (ipAddress) {
    await db.dnsRecord.create({
      data: { zone: "vortex.internal", name: `${name}.db`, type: "A", value: ipAddress, ttl: 120 },
    });
  }

  await writeAudit({
    actor: user.email,
    action: "DATABASE_PROVISIONED",
    resource: `database:${dbId}`,
    detail: `${name} ${engine} ${version} ${(sizeMb / 1024).toFixed(1)}GB app=${app.appId} host=${instance.host} ip=${ipAddress || "none"}`,
    userId: user.id,
  });

  return ok(
    {
      instance,
      credentials: {
        username,
        password, // ONE-TIME display — only the hash is persisted
        host: ipAddress || instance.host,
        port,
        dns: instance.dnsName,
        engine,
      },
    },
    201
  );
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

  const instance = await db.databaseInstance.findUnique({ where: { id: body.id } });
  if (!instance) return fail("Database not found", 404);
  if (instance.status === "DESTROYED") return fail("Database already destroyed");

  const target = body.status;
  if (!DB_STATUS_TRANSITIONS[instance.status]?.includes(target)) {
    return fail(`Cannot go ${instance.status} → ${target}`);
  }

  const data: Record<string, unknown> = { status: target };
  if (target === "DESTROYED") {
    const released = await releaseIpsForNode(instance.dbId);
    await db.dnsRecord.deleteMany({
      where: { zone: "vortex.internal", name: `${instance.name}.db`, type: "A" },
    });
    data.ipAddress = null;
    data.dnsName = null;
    await writeAudit({
      actor: user.email,
      action: "DATABASE_DESTROYED",
      resource: `database:${instance.dbId}`,
      detail: `${instance.name} (${instance.engine}) destroyed, ${released} IP(s) released, DNS record removed`,
      userId: user.id,
    });
  } else {
    await writeAudit({
      actor: user.email,
      action: target === "RUNNING" ? "DATABASE_STARTED" : "DATABASE_STOPPED",
      resource: `database:${instance.dbId}`,
      detail: instance.name,
      userId: user.id,
    });
  }

  const updated = await db.databaseInstance.update({ where: { id: instance.id }, data });
  return ok({ instance: updated });
}

/** Purge a DESTROYED instance from the registry. */
export async function DELETE(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("id query param is required");
  const instance = await db.databaseInstance.findUnique({ where: { id } });
  if (!instance) return fail("Database not found", 404);
  if (instance.status !== "DESTROYED") return fail("Only DESTROYED instances can be purged");

  await db.databaseInstance.delete({ where: { id } });
  await writeAudit({
    actor: user.email,
    action: "DATABASE_PURGED",
    resource: `database:${instance.dbId}`,
    detail: `${instance.name} removed from registry`,
    userId: user.id,
  });
  return ok({ purged: true });
}
