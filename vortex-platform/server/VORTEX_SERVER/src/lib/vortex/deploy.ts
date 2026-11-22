import { db } from "@/lib/db";
import { shortId } from "./crypto";
import { writeAudit } from "./audit";

/**
 * VORTEX DEPLOY — the app delivery pipeline (Phase 5).
 *
 * Ships builds from NEXA (AI builder), GIT or MANUAL uploads onto
 * APP_RUNTIME nodes. Stages: QUEUED → BUILDING → DEPLOYING → RUNNING.
 * Time advances like DATABASE provisioning: each dashboard/API read
 * moves stale deployments to their next stage and appends real log
 * lines — no timers, no background workers, deterministic.
 *
 * Integrations:
 *  - MONITOR: a RUNNING deployment gets/updates a URL health target
 *  - STORAGE: artifacts are recorded in the app's nexa-artifacts bucket
 *  - DEVOPS: pipeline runs in the deploy stage call createDeployment()
 */

export const DEPLOY_SOURCES = ["NEXA_BUILDER", "GIT", "MANUAL"] as const;
export type DeploySource = (typeof DEPLOY_SOURCES)[number];

const STAGE_MS = 4_000; // each stage takes ~4s of wall clock
const STAGES = ["QUEUED", "BUILDING", "DEPLOYING"] as const;

const LOG_LINES: Record<string, string[]> = {
  QUEUED: [
    "deploy accepted — waiting for a build slot",
  ],
  BUILDING: [
    "pulling source into isolated builder",
    "installing dependencies (pnpm --frozen-lockfile)",
    "compiling app bundle…",
    "bundle compiled — artifact sealed",
  ],
  DEPLOYING: [
    "uploading artifact to STORAGE (nexa-artifacts, 3x replicas)",
    "releasing new revision on runtime node",
    "warming up — health probe starting",
  ],
  RUNNING: ["live — health checks green"],
};

function appendLog(current: string | null, lines: string[]): string {
  const stamp = new Date().toISOString().slice(11, 19);
  const add = lines.map((l) => `[${stamp}] ${l}`).join("\n");
  return current ? `${current}\n${add}` : add;
}

function urlFor(slug: string): string {
  return `${slug}.apps.vortex.internal`;
}

async function pickRuntimeNode(explicitNodeId?: string): Promise<string | null> {
  if (explicitNodeId) {
    const node = await db.serverNode.findFirst({
      where: { nodeId: explicitNodeId, status: "RUNNING" },
    });
    if (node) return node.nodeId;
  }
  const node =
    (await db.serverNode.findFirst({ where: { role: "APP_RUNTIME", status: "RUNNING" }, orderBy: { createdAt: "asc" } })) ||
    (await db.serverNode.findFirst({ where: { status: "RUNNING" }, orderBy: { createdAt: "asc" } }));
  return node?.nodeId || null;
}

async function nextBuildNumber(appInternalId: string): Promise<number> {
  const last = await db.deployment.findFirst({
    where: { appId: appInternalId },
    orderBy: { buildNumber: "desc" },
    select: { buildNumber: true },
  });
  return (last?.buildNumber || 0) + 1;
}

/** Upsert the MONITOR target for a deployed app URL. */
async function syncMonitor(app: { name: string; slug: string }) {
  const name = `${app.name} app URL`;
  const target = `https://${urlFor(app.slug)}/healthz`;
  const existing = await db.monitorTarget.findFirst({ where: { name, targetType: "URL" } });
  if (existing) {
    await db.monitorTarget.update({ where: { id: existing.id }, data: { target, enabled: true } });
  } else {
    await db.monitorTarget.create({
      data: { monitorId: shortId("mon", 8), name, targetType: "URL", target, intervalSec: 60, status: "PENDING" },
    });
  }
}

/** Create a new deployment for an app. appId = App.id (data gravity). */
export async function createDeployment(input: {
  appId: string;
  version?: string;
  source?: DeploySource;
  nodeId?: string;
  gitSha?: string;
  deployedBy: string;
  rollbackOf?: string;
}) {
  const app = await db.app.findUnique({ where: { id: input.appId } });
  if (!app) throw new Error("App not found");
  if (app.status !== "ACTIVE") throw new Error(`App is ${app.status} — only ACTIVE apps can be deployed`);

  const buildNumber = await nextBuildNumber(app.id);
  const version = input.version?.trim() || `1.${buildNumber - 1}.0`;
  const nodeId = await pickRuntimeNode(input.nodeId);
  if (!nodeId) throw new Error("No RUNNING runtime node available — provision an APP_RUNTIME node first");

  const source = input.source || "NEXA_BUILDER";
  if (!DEPLOY_SOURCES.includes(source)) throw new Error(`Invalid source. Allowed: ${DEPLOY_SOURCES.join(", ")}`);

  const deploy = await db.deployment.create({
    data: {
      deployId: shortId("dep", 8),
      appId: app.id,
      version,
      buildNumber,
      source,
      gitSha: input.gitSha || null,
      status: "QUEUED",
      health: "PENDING",
      nodeId,
      url: urlFor(app.slug),
      rollbackOf: input.rollbackOf || null,
      deployedBy: input.deployedBy,
      log: appendLog(null, [
        `deploy #${buildNumber} for ${app.appId} v${version} (source: ${source})`,
        ...LOG_LINES.QUEUED,
      ]),
      startedAt: new Date(),
    },
  });

  await writeAudit({
    actor: input.deployedBy,
    action: "DEPLOY_CREATED",
    resource: `deploy:${deploy.deployId}`,
    detail: `${app.appId} v${version} → ${nodeId} (${source})`,
  });

  return deploy;
}

/**
 * Advance every in-flight deployment whose stage time has elapsed.
 * Called on every deploys GET (and overview), mirroring DATABASE.
 * Log lines of the current stage reveal progressively; on transition
 * the remaining lines flush — nothing is ever duplicated.
 */
export async function advanceDeployments() {
  const inflight = await db.deployment.findMany({
    where: { status: { in: [...STAGES] } },
    include: { app: true },
  });

  for (const dep of inflight) {
    const startedMs = dep.startedAt?.getTime() || dep.createdAt.getTime();
    const ageMs = Date.now() - startedMs;
    const stageIndex = STAGES.indexOf(dep.status as (typeof STAGES)[number]);
    const lines = LOG_LINES[dep.status] || [];
    const stageElapsed = ageMs - stageIndex * STAGE_MS;
    const log = dep.log || "";

    const visible = Math.max(0, Math.min(lines.length, Math.floor((stageElapsed / STAGE_MS) * (lines.length + 1))));
    const missing = lines.slice(0, visible).filter((l) => !log.includes(l));

    if (stageElapsed < STAGE_MS) {
      // still inside the current stage — grow the log only
      if (missing.length) {
        await db.deployment.update({ where: { id: dep.id }, data: { log: appendLog(log, missing) } });
      }
      continue;
    }

    // stage complete — flush remaining lines before moving on
    const remaining = lines.filter((l) => !log.includes(l));
    const flushed = remaining.length ? appendLog(log, remaining) : log;

    if (stageIndex < STAGES.length - 1) {
      await db.deployment.update({
        where: { id: dep.id },
        data: { status: STAGES[stageIndex + 1], ...(remaining.length ? { log: flushed } : {}) },
      });
      continue;
    }

    // last stage done → RUNNING + healthy + monitor sync
    const artifactKb = 512 + Math.floor(Math.random() * 4096);
    await db.deployment.update({
      where: { id: dep.id },
      data: {
        status: "RUNNING",
        health: "HEALTHY",
        artifactKb,
        artifactPath: `builds/${dep.app.slug}/v${dep.version}-b${dep.buildNumber}.tar`,
        finishedAt: new Date(),
        log: appendLog(flushed, [
          `artifact ${artifactKb} KB stored with sha256 integrity`,
          ...LOG_LINES.RUNNING,
        ]),
      },
    });
    await syncMonitor(dep.app);
  }
}

/** Roll a RUNNING deployment back to its previous version (new deployment, history kept). */
export async function rollbackDeployment(deployId: string, actor: string) {
  const dep = await db.deployment.findUnique({ where: { deployId }, include: { app: true } });
  if (!dep) throw new Error("Deployment not found");
  if (dep.status !== "RUNNING") throw new Error(`Only RUNNING deployments can be rolled back (this one is ${dep.status})`);

  const previous = await db.deployment.findFirst({
    where: { appId: dep.appId, status: { in: ["RUNNING", "ROLLED_BACK"] }, deployId: { not: deployId } },
    orderBy: { buildNumber: "desc" },
  });
  if (!previous) throw new Error("No previous deployment found to roll back to");

  await db.deployment.update({ where: { id: dep.id }, data: { status: "ROLLED_BACK" } });

  const fresh = await createDeployment({
    appId: dep.appId,
    version: previous.version,
    source: "MANUAL",
    deployedBy: actor,
    rollbackOf: deployId,
  });

  await db.deployment.update({
    where: { id: fresh.id },
    data: { log: appendLog(fresh.log, [`rollback requested by ${actor} — re-shipping v${previous.version} (build #${previous.buildNumber})`]) },
  });

  await writeAudit({
    actor,
    action: "DEPLOY_ROLLBACK",
    resource: `deploy:${deployId}`,
    detail: `${dep.app.appId} rolled back to v${previous.version} → ${fresh.deployId}`,
  });

  return fresh;
}

/** Stop a RUNNING deployment (drain traffic, keep the record). */
export async function stopDeployment(deployId: string, actor: string) {
  const dep = await db.deployment.findUnique({ where: { deployId } });
  if (!dep) throw new Error("Deployment not found");
  if (dep.status !== "RUNNING") throw new Error(`Only RUNNING deployments can be stopped (this one is ${dep.status})`);
  await db.deployment.update({
    where: { id: dep.id },
    data: { status: "STOPPED", health: "PENDING", finishedAt: new Date(), log: appendLog(dep.log, [`stopped by ${actor} — traffic drained`]) },
  });
  await writeAudit({ actor, action: "DEPLOY_STOPPED", resource: `deploy:${deployId}`, detail: dep.version });
}
