import { db } from "@/lib/db";
import { writeAudit } from "./audit";

/**
 * VORTEX AI INFRASTRUCTURE (Phase 6) — model serving for NEXA.
 *
 * Proprietary model registry (vortex-nano / mini / pro) served from the
 * APP_RUNTIME node with q4 quantization. Inference jobs are app-bound,
 * token usage is counted per app — the groundwork for the Phase 7
 * BILLING reserve, never exposed publicly today.
 */

const MAX_PROMPT = 4000;

/** LOADING models finish loading after ~8s. */
export async function advanceModels(): Promise<void> {
  const cutoff = new Date(Date.now() - 8_000);
  const loading = await db.aiModel.findMany({ where: { status: "LOADING", updatedAt: { lte: cutoff } } });
  for (const m of loading) {
    await db.aiModel.update({ where: { id: m.id }, data: { status: "READY", endpoint: `http://ai.vortex.internal/v1/${m.name}` } });
    await writeAudit({
      actor: "system",
      action: "AI_MODEL_READY",
      resource: `model:${m.modelId}`,
      detail: `${m.name} (${m.paramsB}, ${m.quant}) finished loading on the serving node`,
    });
  }
}

export async function aiState() {
  const [models, jobs, apps] = await Promise.all([
    db.aiModel.findMany({ orderBy: { createdAt: "asc" }, include: { app: { select: { name: true, appId: true } } } }),
    db.aiJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { model: { select: { name: true, modelId: true } }, app: { select: { name: true, appId: true } } },
    }),
    db.app.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, appId: true } }),
  ]);
  const done24h = await db.aiJob.count({ where: { status: "DONE", createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } });
  return {
    models,
    jobs,
    apps,
    stats: {
      modelsReady: models.filter((m) => m.status === "READY").length,
      modelsTotal: models.length,
      jobs24h: done24h,
      tokensIn: models.reduce((a, m) => a + m.tokensIn, 0),
      tokensOut: models.reduce((a, m) => a + m.tokensOut, 0),
    },
  };
}

export async function toggleModel(modelId: string, actor: string): Promise<{ status: string } | { error: string }> {
  const m = await db.aiModel.findUnique({ where: { modelId } });
  if (!m) return { error: "Model not found" };
  let next: string;
  if (m.status === "READY") next = "OFFLINE";
  else if (m.status === "OFFLINE") next = "LOADING";
  else next = "READY"; // LOADING → cancel load
  await db.aiModel.update({ where: { modelId }, data: { status: next } });
  await writeAudit({
    actor,
    action: `AI_MODEL_${next}`,
    resource: `model:${modelId}`,
    detail: `${m.name} (${m.paramsB}) → ${next}`,
  });
  return { status: next };
}

/** Deterministic mock generation — honest about being a sandbox serving stub. */
function mockCompletion(prompt: string, model: { name: string; paramsB: string }): string {
  const topic = prompt.trim().split(/\s+/).slice(0, 8).join(" ") || "the request";
  return [
    `[${model.name} · ${model.paramsB} · VORTEX internal serving]`,
    `Understood: "${topic}${prompt.trim().length > 40 ? "…" : ""}".`,
    `Draft response: the request is handled inside the private VORTEX AI runtime — no data leaves the ecosystem (data gravity applies to inference too).`,
    `Note: this sandbox returns a deterministic stub; the production weights slot into the same endpoint contract.`,
  ].join("\n");
}

export async function runInference(opts: {
  modelId: string;
  prompt: string;
  appId?: string | null;
  actor: string;
}): Promise<{ jobId: string; output: string; tokensIn: number; tokensOut: number; latencyMs: number } | { error: string }> {
  const model = await db.aiModel.findUnique({ where: { modelId: opts.modelId } });
  if (!model) return { error: "Model not found" };
  if (model.status !== "READY") return { error: `Model "${model.name}" is ${model.status} — flip it to READY first` };
  const prompt = opts.prompt.trim().slice(0, MAX_PROMPT);
  if (!prompt) return { error: "Prompt is empty" };

  if (opts.appId) {
    const app = await db.app.findUnique({ where: { id: opts.appId } });
    if (!app) return { error: "App not found" };
  }

  const tokensIn = Math.max(1, Math.ceil(prompt.length / 4));
  const tokensOut = 60 + Math.floor(Math.random() * 120);
  const latencyMs = Math.round(120 + (parseInt(model.paramsB) || 2) * 18 + Math.random() * 260);
  const output = mockCompletion(prompt, model);
  const jobId = `job_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;

  const job = await db.aiJob.create({
    data: {
      jobId,
      modelId: model.id,
      appId: opts.appId || null,
      prompt: prompt.slice(0, 400),
      status: "DONE",
      tokensIn,
      tokensOut,
      latencyMs,
      output,
      finishedAt: new Date(),
    },
  });

  // rolling average latency + usage counters (feeds future billing, Phase 7 reserve)
  const newCount = model.requests + 1;
  const newAvg = Math.round((model.avgLatencyMs * model.requests + latencyMs) / newCount);
  await db.aiModel.update({
    where: { id: model.id },
    data: { requests: { increment: 1 }, tokensIn: { increment: tokensIn }, tokensOut: { increment: tokensOut }, avgLatencyMs: newAvg },
  });

  await writeAudit({
    actor: opts.actor,
    action: "AI_INFERENCE",
    resource: `job:${job.id}`,
    detail: `model=${model.name} app=${opts.appId || "control-plane"} tokens_in=${tokensIn} tokens_out=${tokensOut} latency=${latencyMs}ms`,
  });

  return { jobId: job.jobId, output, tokensIn, tokensOut, latencyMs };
}
