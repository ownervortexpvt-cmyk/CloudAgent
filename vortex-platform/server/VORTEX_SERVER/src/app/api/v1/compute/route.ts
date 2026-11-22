import { ok, fail, requireSession } from "@/lib/vortex/api";
import { ensureSeeded } from "@/lib/vortex/seed";
import { advanceWorkloads, computeState, createWorkload, workloadAction } from "@/lib/vortex/compute";

/**
 * COMPUTE MODULE (Phase 6) — runtime workloads for apps.
 * GET  — workloads (with app + node), runtime nodes, quota, stats.
 * POST — { op: "create" | "start" | "stop" | "restart" | "destroy" }
 */
export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  await advanceWorkloads(); // finish provisioning that has matured
  return ok(await computeState());
}

export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: {
    op?: string;
    name?: string;
    image?: string;
    kind?: string;
    appId?: string | null;
    cpuMilli?: number;
    ramMb?: number;
    workloadId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  switch (body.op) {
    case "create": {
      const res = await createWorkload({
        name: body.name || "",
        image: body.image || "",
        kind: body.kind,
        appId: body.appId || null,
        cpuMilli: body.cpuMilli,
        ramMb: body.ramMb,
        actor: user.email,
      });
      if ("error" in res) return fail(res.error);
      return ok(res);
    }
    case "start":
    case "stop":
    case "restart":
    case "destroy": {
      if (!body.workloadId) return fail("workloadId is required");
      const res = await workloadAction(body.workloadId, body.op, user.email);
      if ("error" in res) return fail(res.error);
      return ok(res);
    }
    default:
      return fail(`Unknown op "${body.op}" — use create | start | stop | restart | destroy`);
  }
}
