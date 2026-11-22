import { ok, fail, requireSession } from "@/lib/vortex/api";
import { ensureSeeded } from "@/lib/vortex/seed";
import { advanceCdn, cdnState, createDistribution, purgeDistribution, toggleDistribution, deleteDistribution } from "@/lib/vortex/cdn";

/**
 * CDN MODULE (Phase 6) — edge cache in front of STORAGE.
 * GET  — distributions, selectable buckets, cache stats.
 * POST — { op: "create" | "purge" | "pause" | "resume" | "delete" }
 */
export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  await advanceCdn(); // cache accounting advances with real bucket state
  return ok(await cdnState());
}

export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { op?: string; name?: string; bucketId?: string; domain?: string; defaultTtlSec?: number; distId?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  switch (body.op) {
    case "create": {
      if (!body.name?.trim()) return fail("Distribution name is required");
      if (!body.bucketId) return fail("Pick a bucket to put on the edge");
      const res = await createDistribution({
        name: body.name.trim().slice(0, 60),
        bucketId: body.bucketId,
        domain: body.domain?.trim() || undefined,
        defaultTtlSec: body.defaultTtlSec,
        createdBy: user.email,
      });
      if ("error" in res) return fail(res.error);
      return ok(res);
    }
    case "purge": {
      if (!body.distId) return fail("distId is required");
      const res = await purgeDistribution(body.distId, user.email);
      if ("error" in res) return fail(res.error);
      return ok(res);
    }
    case "pause":
    case "resume": {
      if (!body.distId) return fail("distId is required");
      const res = await toggleDistribution(body.distId, body.op === "pause" ? "PAUSED" : "ACTIVE", user.email);
      if ("error" in res) return fail(res.error);
      return ok(res);
    }
    case "delete": {
      if (!body.distId) return fail("distId is required");
      const res = await deleteDistribution(body.distId, user.email);
      if ("error" in res) return fail(res.error);
      return ok(res);
    }
    default:
      return fail(`Unknown op "${body.op}" — use create | purge | pause | resume | delete`);
  }
}
