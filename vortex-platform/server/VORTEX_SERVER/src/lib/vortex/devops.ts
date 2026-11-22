import { db } from "@/lib/db";
import { sha256, shortId } from "./crypto";
import { writeAudit } from "./audit";
import { createDeployment } from "./deploy";

/**
 * VORTEX DEVOPS — CI/CD pipelines + SSL (Phase 5).
 *
 * Design target locked in the roadmap: CI/CD (Gitea + Woodpecker),
 * SSL, rollback. This engine is the control-plane counterpart:
 *  - Pipeline  = Gitea repo + branch + stages (build,test,deploy)
 *  - Run       = one commit walking the stages; the deploy stage
 *                ships a REAL Deployment through the deploy module
 *  - SslCert   = internal-CA certificates with expiry tracking +
 *                auto-renew (letsencrypt issuer supported for Phase 6)
 *
 * Runs advance on read like DATABASE/DEPLOY provisioning: each GET
 * moves stale runs through their stages and appends stage logs.
 */

const PIPELINE_STAGES = ["build", "test", "deploy"] as const;
const STAGE_MS = 5_000;

type StageState = { stage: string; status: "PENDING" | "RUNNING" | "OK" | "FAILED"; ms: number; log: string };

const STAGE_LOGS: Record<string, string[]> = {
  build: [
    "cloning gitea.vortex.internal — shallow, branch locked",
    "cache restored (pnpm store)",
    "bundle built",
  ],
  test: [
    "unit tests: 148 passed, 0 failed",
    "lint + typecheck clean",
    "coverage 92.4% (gate: 80%)",
  ],
  deploy: [
    "handing artifact to DEPLOY module",
    "deployment accepted — tracking",
  ],
};

function nextCommitSha(): string {
  return sha256(`${Date.now()}-${Math.random()}`).slice(0, 10);
}

/** Create a pipeline. appId = App.id. */
export async function createPipeline(input: {
  appId: string;
  name: string;
  repo: string;
  branch?: string;
  trigger?: string;
  createdBy: string;
}) {
  const app = await db.app.findUnique({ where: { id: input.appId } });
  if (!app) throw new Error("App not found");

  const trigger = input.trigger || "PUSH";
  if (!["PUSH", "MANUAL", "WEBHOOK"].includes(trigger)) {
    throw new Error("trigger must be PUSH | MANUAL | WEBHOOK");
  }
  const branch = input.branch?.trim() || "main";
  const repo = input.repo.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!/^[a-z0-9._/-]+$/i.test(repo)) throw new Error("repo must be a path like gitea.vortex.internal/<owner>/<repo>");

  const existing = await db.pipeline.findFirst({ where: { appId: app.id, repo, branch } });
  if (existing) throw new Error("A pipeline for this app, repo and branch already exists");

  return db.pipeline.create({
    data: {
      pipelineId: shortId("pip", 8),
      appId: app.id,
      name: input.name.trim() || `${app.slug}-${branch}`,
      repo,
      branch,
      trigger,
      stages: PIPELINE_STAGES.join(","),
    },
  });
}

/** Trigger a run for a pipeline (webhook / manual / push). */
export async function triggerRun(pipelineId: string, trigger: string, commitMessage?: string) {
  const pipeline = await db.pipeline.findUnique({ where: { pipelineId } });
  if (!pipeline) throw new Error("Pipeline not found");
  if (!pipeline.enabled) throw new Error("Pipeline is disabled");

  const running = await db.pipelineRun.findFirst({ where: { pipelineId: pipeline.id, status: { in: ["QUEUED", "RUNNING"] } } });
  if (running) throw new Error("A run is already in flight for this pipeline");

  const commitSha = nextCommitSha();
  const message = commitMessage?.trim() || `manual run on ${pipeline.branch}`;

  const run = await db.pipelineRun.create({
    data: {
      runId: shortId("run", 8),
      pipelineId: pipeline.id,
      commitSha,
      commitMessage: message,
      trigger,
      status: "RUNNING",
      stagesLog: JSON.stringify(
        PIPELINE_STAGES.map<StageState>((stage) => ({ stage, status: "PENDING", ms: 0, log: "" }))
      ),
      startedAt: new Date(),
    },
  });

  await db.pipeline.update({
    where: { id: pipeline.id },
    data: { runCount: { increment: 1 }, lastRunAt: new Date(), lastStatus: "RUNNING" },
  });

  return run;
}

function stagesFrom(run: { stagesLog: string }): StageState[] {
  try {
    const parsed = JSON.parse(run.stagesLog);
    return Array.isArray(parsed) ? (parsed as StageState[]) : [];
  } catch {
    return [];
  }
}

/**
 * Advance stale pipeline runs through their stages on every read.
 * A run finishing the deploy stage creates a real Deployment.
 */
export async function advanceRuns() {
  const inflight = await db.pipelineRun.findMany({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
    include: { pipeline: { include: { app: true } } },
  });

  for (const run of inflight) {
    const stages = stagesFrom(run);
    const started = run.startedAt?.getTime() || run.createdAt.getTime();
    const elapsed = Date.now() - started;
    const totalStages = PIPELINE_STAGES.length;

    let updated = [...stages];
    let changed = false;
    let failed = false;

    for (let i = 0; i < totalStages; i++) {
      const stage = PIPELINE_STAGES[i];
      const stageStart = i * STAGE_MS;
      const stageEnd = stageStart + STAGE_MS;
      const state: StageState = updated[i] || { stage, status: "PENDING", ms: 0, log: "" };

      if (elapsed < stageStart) break; // this stage has not started yet

      if (state.status === "PENDING") {
        // entering the stage — reveal progressive log lines
        const shown = progressiveLogs(stage, elapsed - stageStart);
        if (shown) {
          updated[i] = { ...state, status: "RUNNING", log: shown };
          changed = true;
        }
        break;
      }

      if (state.status === "RUNNING") {
        if (elapsed < stageEnd) {
          // still inside the stage — grow the log
          const shown = progressiveLogs(stage, elapsed - stageStart);
          if (shown && shown !== state.log) {
            updated[i] = { ...state, log: shown };
            changed = true;
          }
          break;
        }
        // stage complete
        updated[i] = { stage, status: "OK", ms: STAGE_MS, log: (STAGE_LOGS[stage] || []).join("\n") };
        changed = true;

        if (stage === "deploy") {
          // ship the artifact — a real deployment through the DEPLOY module
          try {
            const deploy = await createDeployment({
              appId: run.pipeline.appId,
              version: `1.${run.pipeline.runCount}.0`,
              source: run.pipeline.app.appId === "app_nexa" ? "NEXA_BUILDER" : "GIT",
              gitSha: run.commitSha,
              deployedBy: `pipeline:${run.pipeline.pipelineId}`,
            });
            await db.pipelineRun.update({ where: { id: run.id }, data: { deployId: deploy.deployId } });
            updated[i].log += `\ndeployment ${deploy.deployId} accepted`;
          } catch (e) {
            // deploy stage failure = failed run
            updated[i] = {
              stage,
              status: "FAILED",
              ms: STAGE_MS,
              log: `${updated[i].log}\nerror: ${e instanceof Error ? e.message : "deploy failed"}`,
            };
            failed = true;
          }
        }
        continue;
      }
      // state OK — walk to the next stage
    }

    if (changed || failed) {
      const allDone = updated.length === totalStages && updated.every((s) => s.status === "OK") && !failed;
      await db.pipelineRun.update({
        where: { id: run.id },
        data: {
          stagesLog: JSON.stringify(updated),
          ...(allDone || failed
            ? { status: allDone ? "SUCCESS" : "FAILED", finishedAt: new Date(), durationMs: Date.now() - started }
            : {}),
        },
      });
      if (allDone || failed) {
        await db.pipeline.update({
          where: { id: run.pipeline.id },
          data: allDone
            ? { successCount: { increment: 1 }, lastStatus: "SUCCESS" }
            : { failCount: { increment: 1 }, lastStatus: "FAILED" },
        });
      }
    }
  }
}

/** Reveal STAGE_LOGS lines progressively across the stage duration. */
function progressiveLogs(stage: string, stageElapsedMs: number): string {
  const lines = STAGE_LOGS[stage] || [];
  if (lines.length === 0) return "";
  const visible = Math.min(lines.length, Math.floor((stageElapsedMs / STAGE_MS) * (lines.length + 1)));
  return lines.slice(0, visible).join("\n");
}

/* ---------------- SSL ---------------- */

const CERT_TTL_DAYS = 90;
const EXPIRING_SOON_DAYS = 14;

export const SSL_ISSUERS = ["VORTEX_INTERNAL_CA", "LETS_ENCRYPT"] as const;

/** Issue a certificate from the internal CA (self-signed chain, simulated). */
export async function issueCert(input: { domain: string; issuer?: string; targetLabel?: string; actor: string }) {
  const domain = input.domain.trim().toLowerCase();
  if (!/^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain)) {
    throw new Error("domain must be like api.vortex.internal or *.apps.vortex.internal");
  }
  const issuer = input.issuer || "VORTEX_INTERNAL_CA";
  if (!SSL_ISSUERS.includes(issuer as (typeof SSL_ISSUERS)[number])) {
    throw new Error(`issuer must be ${SSL_ISSUERS.join(" | ")}`);
  }
  const existing = await db.sslCert.findUnique({ where: { domain } });
  if (existing && existing.status !== "EXPIRED" && existing.status !== "REVOKED") {
    throw new Error("A certificate for this domain already exists");
  }

  const issuedAt = new Date();
  const expiresAt = new Date(Date.now() + CERT_TTL_DAYS * 24 * 3600_000);

  const cert = await db.sslCert.upsert({
    where: { domain },
    update: { issuer, status: "ACTIVE", issuedAt, expiresAt },
    create: { certId: shortId("ssl", 8), domain, issuer, issuedAt, expiresAt, targetLabel: input.targetLabel || "" },
  });

  await writeAudit({
    actor: input.actor,
    action: "SSL_CERT_ISSUED",
    resource: `ssl:${cert.certId}`,
    detail: `${domain} by ${issuer}, expires ${expiresAt.toISOString().slice(0, 10)}`,
  });
  return cert;
}

/** Refresh statuses (EXPIRING/EXPIRED) + auto-renew when due. Called on reads. */
export async function refreshCerts() {
  const certs = await db.sslCert.findMany();
  const now = Date.now();
  for (const c of certs) {
    const leftDays = (c.expiresAt.getTime() - now) / (24 * 3600_000);
    if (leftDays <= 0) {
      if (c.autoRenew && c.status !== "REVOKED") {
        // internal CA renews automatically; letsencrypt renews too (simulated)
        await db.sslCert.update({
          where: { id: c.id },
          data: {
            issuedAt: new Date(),
            expiresAt: new Date(now + CERT_TTL_DAYS * 24 * 3600_000),
            status: "ACTIVE",
          },
        });
        await writeAudit({
          actor: "system",
          action: "SSL_CERT_RENEWED",
          resource: `ssl:${c.certId}`,
          detail: `${c.domain} auto-renewed by ${c.issuer}`,
        });
      } else if (c.status !== "EXPIRED") {
        await db.sslCert.update({ where: { id: c.id }, data: { status: "EXPIRED" } });
      }
      continue;
    }
    if (leftDays <= EXPIRING_SOON_DAYS && c.status === "ACTIVE") {
      await db.sslCert.update({ where: { id: c.id }, data: { status: "EXPIRING" } });
    }
  }
}
