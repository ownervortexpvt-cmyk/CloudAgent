import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { writeAudit } from "@/lib/vortex/audit";
import { ensureSeeded } from "@/lib/vortex/seed";
import { createPipeline } from "@/lib/vortex/devops";

/**
 * PIPELINES — create / toggle / delete CI/CD pipelines.
 * POST   { appId (App.id), name, repo, branch?, trigger? }
 * PATCH  { id, enabled }
 * DELETE ?id=
 */
export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { appId?: string; name?: string; repo?: string; branch?: string; trigger?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  if (!body.appId) return fail("appId is required — pipelines ship one app (data gravity)");
  if (!body.repo || !body.name) return fail("name and repo are required");

  try {
    const pipeline = await createPipeline({
      appId: body.appId,
      name: body.name,
      repo: body.repo,
      branch: body.branch,
      trigger: body.trigger,
      createdBy: user.email,
    });
    await writeAudit({
      actor: user.email,
      action: "PIPELINE_CREATED",
      resource: `pipeline:${pipeline.pipelineId}`,
      detail: `${pipeline.name} → ${pipeline.repo}#${pipeline.branch} (${pipeline.trigger})`,
      userId: user.id,
    });
    return ok({ pipeline }, 201);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not create pipeline");
  }
}

export async function PATCH(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { id?: string; enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }
  if (!body.id || typeof body.enabled !== "boolean") return fail("id and enabled are required");

  const pipeline = await db.pipeline.findUnique({ where: { id: body.id } });
  if (!pipeline) return fail("Pipeline not found", 404);

  const updated = await db.pipeline.update({ where: { id: pipeline.id }, data: { enabled: body.enabled } });
  await writeAudit({
    actor: user.email,
    action: body.enabled ? "PIPELINE_ENABLED" : "PIPELINE_DISABLED",
    resource: `pipeline:${pipeline.pipelineId}`,
    detail: pipeline.name,
    userId: user.id,
  });
  return ok({ pipeline: updated });
}

export async function DELETE(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("id query param is required");
  const pipeline = await db.pipeline.findUnique({ where: { id } });
  if (!pipeline) return fail("Pipeline not found", 404);

  await db.pipeline.delete({ where: { id } });
  await writeAudit({
    actor: user.email,
    action: "PIPELINE_DELETED",
    resource: `pipeline:${pipeline.pipelineId}`,
    detail: `${pipeline.name} (${pipeline.repo}) removed`,
    userId: user.id,
  });
  return ok({ removed: true });
}
