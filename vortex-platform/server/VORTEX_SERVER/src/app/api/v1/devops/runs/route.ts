import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { writeAudit } from "@/lib/vortex/audit";
import { ensureSeeded } from "@/lib/vortex/seed";
import { advanceRuns, triggerRun } from "@/lib/vortex/devops";

/**
 * PIPELINE RUNS — trigger + inspect.
 * POST  { pipelineId, commitMessage? } → start a run (walks build → test → deploy;
 *         the deploy stage ships a REAL Deployment through the DEPLOY module).
 */
export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  await advanceRuns();
  const runs = await db.pipelineRun.findMany({
    orderBy: { createdAt: "desc" },
    include: { pipeline: { select: { name: true, branch: true, app: { select: { name: true, appId: true } } } } },
    take: 40,
  });
  return ok({ runs });
}

export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { pipelineId?: string; commitMessage?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }
  if (!body.pipelineId) return fail("pipelineId is required");

  try {
    const run = await triggerRun(body.pipelineId, "MANUAL", body.commitMessage);
    await writeAudit({
      actor: user.email,
      action: "PIPELINE_RUN_TRIGGERED",
      resource: `pipeline-run:${run.runId}`,
      detail: `pipeline ${body.pipelineId} — commit ${run.commitSha}`,
      userId: user.id,
    });
    return ok({ run }, 201);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not trigger run");
  }
}
