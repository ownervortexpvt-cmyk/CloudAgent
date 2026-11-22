import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { ensureSeeded } from "@/lib/vortex/seed";
import { blockIp, unblockIp } from "@/lib/vortex/security";

/**
 * IP BLOCKLIST — manual blocks (SECURITY auto-blocks land here too).
 * POST   { ip, reason, hours? }  hours=null|omitted → permanent
 * DELETE ?ip=1.2.3.4             lift the block
 */
export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const blocks = await db.ipBlock.findMany({ orderBy: { createdAt: "desc" } });
  return ok({ blocks });
}

export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: { ip?: string; reason?: string; hours?: number | null };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const ip = (body.ip || "").trim();
  if (!ip) return fail("ip is required");
  const reason = (body.reason || "").trim() || "Manually blocked by owner";
  let hours: number | null = null;
  if (body.hours !== null && body.hours !== undefined && body.hours !== 0) {
    if (typeof body.hours !== "number" || body.hours < 1 || body.hours > 8760) {
      return fail("hours must be 1-8760, 0/null for permanent");
    }
    hours = Math.round(body.hours);
  }

  try {
    const block = await blockIp({ ip, reason, source: "MANUAL", createdBy: user.email, hours });
    return ok({ block }, 201);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not block IP");
  }
}

export async function DELETE(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const ip = new URL(req.url).searchParams.get("ip");
  if (!ip) return fail("ip query param is required");

  const done = await unblockIp(ip, user.email);
  if (!done) return fail("No active block for this IP", 404);
  return ok({ unblocked: true });
}
