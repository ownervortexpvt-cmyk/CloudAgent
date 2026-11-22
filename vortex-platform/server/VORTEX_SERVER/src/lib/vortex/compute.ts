import { db } from "@/lib/db";
import { writeAudit } from "./audit";

/**
 * VORTEX COMPUTE (Phase 6) — runtime workloads for apps.
 *
 * DEPLOY ships a build once; COMPUTE owns the long-running runtime
 * containers/functions/cron jobs that keep apps alive, scheduled onto
 * APP_RUNTIME nodes with CPU/RAM guarantees (KVM/libvirt design).
 * Lifecycle: PROVISIONING → RUNNING ⇄ STOPPED → DESTROYED.
 */

const PROVISION_MS = 6_000;

async function maxPerApp(): Promise<number> {
  const cfg = await db.appConfig.findUnique({ where: { key: "compute.max_per_app" } });
  return Number(cfg?.value || 6);
}

/** Pick the APP_RUNTIME node with the most free RAM (running first). */
async function pickNode(): Promise<{ nodeId: string; name: string } | null> {
  const nodes = await db.serverNode.findMany({ where: { role: "APP_RUNTIME", status: "RUNNING" } });
  if (nodes.length === 0) return null;
  const workloads = await db.workload.findMany({ where: { status: { in: ["RUNNING", "PROVISIONING"] } } });
  const usedByNode = new Map<string, number>();
  for (const w of workloads) {
    if (!w.nodeId) continue;
    usedByNode.set(w.nodeId, (usedByNode.get(w.nodeId) || 0) + w.ramMb);
  }
  const scored = nodes
    .map((n) => ({ nodeId: n.nodeId, name: n.name, free: n.ramMb - (usedByNode.get(n.nodeId) || 0) }))
    .sort((a, b) => b.free - a.free);
  return scored[0];
}

/** PROVISIONING workloads go RUNNING after a few seconds. */
export async function advanceWorkloads(): Promise<void> {
  const cutoff = new Date(Date.now() - PROVISION_MS);
  const pending = await db.workload.findMany({ where: { status: "PROVISIONING", createdAt: { lte: cutoff } } });
  for (const w of pending) {
    await db.workload.update({ where: { id: w.id }, data: { status: "RUNNING", startedAt: new Date() } });
    await writeAudit({
      actor: "system",
      action: "WORKLOAD_RUNNING",
      resource: `workload:${w.workloadId}`,
      detail: `${w.name} (${w.image}) is live on ${w.nodeId || "runtime node"}`,
    });
  }
}

export async function computeState() {
  const [workloads, nodes] = await Promise.all([
    db.workload.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        app: { select: { name: true, appId: true } },
        node: { select: { name: true, nodeId: true } },
      },
    }),
    db.serverNode.findMany({ where: { role: "APP_RUNTIME", status: "RUNNING" }, select: { name: true, nodeId: true, cpuCores: true, ramMb: true } }),
  ]);
  const running = workloads.filter((w) => w.status === "RUNNING");
  return {
    workloads,
    nodes,
    quotaPerApp: await maxPerApp(),
    stats: {
      total: workloads.filter((w) => w.status !== "DESTROYED").length,
      running: running.length,
      stopped: workloads.filter((w) => ["STOPPED", "CRASHED"].includes(w.status)).length,
      cpuMilli: running.reduce((a, w) => a + w.cpuMilli, 0),
      ramMb: running.reduce((a, w) => a + w.ramMb, 0),
    },
  };
}

export async function createWorkload(opts: {
  name: string;
  image: string;
  kind?: string;
  appId?: string | null;
  cpuMilli?: number;
  ramMb?: number;
  actor: string;
}): Promise<{ workloadId: string; node: string | null } | { error: string }> {
  const name = opts.name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  if (!name) return { error: "Workload name is required" };
  if (!opts.image || !opts.image.includes(":")) return { error: "Image must include a tag, e.g. vortex/nexa-runtime:1.4" };
  const kind = ["CONTAINER", "FUNCTION", "CRON"].includes(opts.kind || "") ? opts.kind! : "CONTAINER";
  const cpuMilli = Math.min(Math.max(opts.cpuMilli || 500, 100), 4000);
  const ramMb = Math.min(Math.max(opts.ramMb || 512, 128), 8192);

  if (opts.appId) {
    const quota = await maxPerApp();
    const count = await db.workload.count({ where: { appId: opts.appId, status: { not: "DESTROYED" } } });
    if (count >= quota) return { error: `Quota reached: max ${quota} workloads per app` };
    const app = await db.app.findUnique({ where: { id: opts.appId } });
    if (!app) return { error: "App not found" };
  }

  const node = await pickNode();
  const workloadId = `wrk_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
  await db.workload.create({
    data: {
      workloadId,
      name,
      image: opts.image,
      kind,
      appId: opts.appId || null,
      nodeId: node?.nodeId || null,
      cpuMilli,
      ramMb,
      status: "PROVISIONING",
    },
  });
  await writeAudit({
    actor: opts.actor,
    action: "WORKLOAD_CREATED",
    resource: `workload:${workloadId}`,
    detail: `${name} image=${opts.image} kind=${kind} cpu=${cpuMilli}m ram=${ramMb}MB node=${node?.name || "none-free"}`,
  });
  return { workloadId, node: node?.name || null };
}

export async function workloadAction(
  workloadId: string,
  action: "start" | "stop" | "restart" | "destroy",
  actor: string
): Promise<{ status: string } | { error: string }> {
  const w = await db.workload.findUnique({ where: { workloadId } });
  if (!w) return { error: "Workload not found" };
  if (w.status === "PROVISIONING") return { error: "Workload is still provisioning — try again in a few seconds" };

  if (action === "start") {
    if (w.status === "RUNNING") return { error: "Workload already running" };
    const node = w.nodeId ? { nodeId: w.nodeId } : await pickNode();
    await db.workload.update({
      where: { workloadId },
      data: { status: "RUNNING", startedAt: new Date(), nodeId: node?.nodeId || null },
    });
  } else if (action === "stop") {
    if (w.status !== "RUNNING") return { error: "Workload is not running" };
    await db.workload.update({ where: { workloadId }, data: { status: "STOPPED", startedAt: null } });
  } else if (action === "restart") {
    if (w.status !== "RUNNING" && w.status !== "CRASHED") return { error: "Only running/crashed workloads can restart" };
    await db.workload.update({
      where: { workloadId },
      data: { status: "RUNNING", restartCount: { increment: 1 }, startedAt: new Date() },
    });
  } else {
    await db.workload.update({ where: { workloadId }, data: { status: "DESTROYED", startedAt: null } });
  }

  await writeAudit({
    actor,
    action: `WORKLOAD_${action.toUpperCase()}`,
    resource: `workload:${workloadId}`,
    detail: `${w.name} → ${action}`,
  });
  const updated = await db.workload.findUnique({ where: { workloadId }, select: { status: true } });
  return { status: updated?.status || "UNKNOWN" };
}
