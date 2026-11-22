import { db } from "@/lib/db";
import { ok, requireSession } from "@/lib/vortex/api";
import { ensureSeeded } from "@/lib/vortex/seed";
import { advanceRuns, refreshCerts } from "@/lib/vortex/devops";

/**
 * DEVOPS MODULE (Phase 5) — CI/CD + SSL state.
 * GET — pipelines (with app), recent runs, SSL certificates, 24h stats.
 * Stale runs advance on read; certificates refresh/renew on read.
 */
export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  await advanceRuns();
  await refreshCerts();

  const since24h = new Date(Date.now() - 24 * 3600_000);
  const [pipelines, runs, certs, runsSuccess24h, runsFailed24h] = await Promise.all([
    db.pipeline.findMany({
      orderBy: { createdAt: "asc" },
      include: { app: { select: { name: true, appId: true, slug: true } } },
    }),
    db.pipelineRun.findMany({
      orderBy: { createdAt: "desc" },
      include: { pipeline: { select: { pipelineId: true, name: true, branch: true, app: { select: { name: true, appId: true } } } } },
      take: 40,
    }),
    db.sslCert.findMany({ orderBy: { domain: "asc" } }),
    db.pipelineRun.count({ where: { status: "SUCCESS", createdAt: { gte: since24h } } }),
    db.pipelineRun.count({ where: { status: "FAILED", createdAt: { gte: since24h } } }),
  ]);

  const now = Date.now();
  const certsOut = certs.map((c) => ({
    ...c,
    daysLeft: Math.max(0, Math.round((c.expiresAt.getTime() - now) / (24 * 3600_000))),
  }));

  return ok({
    pipelines,
    runs,
    certs: certsOut,
    stats: { runsSuccess24h, runsFailed24h, pipelinesActive: pipelines.filter((p) => p.enabled).length },
  });
}
