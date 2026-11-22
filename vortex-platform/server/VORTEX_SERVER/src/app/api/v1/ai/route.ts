import { ok, fail, requireSession } from "@/lib/vortex/api";
import { ensureSeeded } from "@/lib/vortex/seed";
import { advanceModels, aiState, toggleModel, runInference } from "@/lib/vortex/ai";

/**
 * AI INFRASTRUCTURE MODULE (Phase 6) — model serving for NEXA.
 * GET  — models, job feed, apps, token stats.
 * POST — { op: "infer" | "toggle" }
 */
export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  await advanceModels(); // LOADING models mature to READY
  return ok(await aiState());
}

export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { op?: string; modelId?: string; prompt?: string; appId?: string | null };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  switch (body.op) {
    case "infer": {
      if (!body.modelId) return fail("modelId is required");
      const res = await runInference({
        modelId: body.modelId,
        prompt: body.prompt || "",
        appId: body.appId || null,
        actor: user.email,
      });
      if ("error" in res) return fail(res.error);
      return ok(res);
    }
    case "toggle": {
      if (!body.modelId) return fail("modelId is required");
      const res = await toggleModel(body.modelId, user.email);
      if ("error" in res) return fail(res.error);
      return ok(res);
    }
    default:
      return fail(`Unknown op "${body.op}" — use infer | toggle`);
  }
}
