import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { ensureSeeded } from "@/lib/vortex/seed";
import { advanceDeployments, createDeployment, rollbackDeployment, stopDeployment, DEPLOY_SOURCES } from "@/lib/vortex/deploy";

/**
 * DEPLOY MODULE (Phase 5) — ship app builds onto runtime nodes.
 * GET   — all deployments (stale QUEUED/BUILDING/DEPLOYING advance first)
 *         + runtime nodes + apps for the deploy form.
 * POST  — create a deployment { appId (App.id), version?, source?, nodeId? }
 * PATCH — action: ROLLBACK | STOP on { deployId }.
 */
export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  await advanceDeployments();

  const [deployments, nodes, apps] = await Promise.all([
    db.deployment.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        app: { select: { name: true, appId: true, slug: true } },
        node: { select: { name: true } },
      },
      take: 60,
    }),
    db.serverNode.findMany({
      where: { status: "RUNNING" },
      select: { nodeId: true, name: true, role: true },
      orderBy: { createdAt: "asc" },
    }),
    db.app.findMany({ where: { status: "ACTIVE" }, select: { id: true, appId: true, name: true, slug: true }, orderBy: { createdAt: "asc" } }),
  ]);

  return ok({ deployments, nodes, apps, sources: DEPLOY_SOURCES });
}

export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { appId?: string; version?: string; source?: string; nodeId?: string; gitSha?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  if (!body.appId) return fail("appId is required — every deployment belongs to an app (data gravity)");

  try {
    const deploy = await createDeployment({
      appId: body.appId,
      version: body.version,
      source: (body.source as "NEXA_BUILDER" | "GIT" | "MANUAL") || "NEXA_BUILDER",
      nodeId: body.nodeId,
      gitSha: body.gitSha,
      deployedBy: user.email,
    });
    return ok({ deploy }, 201);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Deployment failed to queue");
  }
}

export async function PATCH(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { deployId?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }
  if (!body.deployId || !body.action) return fail("deployId and action are required");

  try {
    if (body.action === "ROLLBACK") {
      const fresh = await rollbackDeployment(body.deployId, user.email);
      return ok({ deploy: fresh, rolledBack: body.deployId });
    }
    if (body.action === "STOP") {
      await stopDeployment(body.deployId, user.email);
      return ok({ stopped: body.deployId });
    }
    return fail("action must be ROLLBACK | STOP");
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Action failed");
  }
}
