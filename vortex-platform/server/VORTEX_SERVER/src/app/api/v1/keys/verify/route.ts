import { db } from "@/lib/db";
import { ok, fail } from "@/lib/vortex/api";
import { sha256 } from "@/lib/vortex/crypto";
import { rateLimit, getClientIp } from "@/lib/vortex/ratelimit";
import { ensureSeeded } from "@/lib/vortex/seed";

/**
 * SDK-style key verification — the pattern every VORTEX app will use:
 *
 *   curl -H "Authorization: Bearer vx_live_xxx" /api/v1/keys/verify
 *
 * No session needed: this is the machine-to-machine path (API module groundwork).
 */
export async function POST(req: Request) {
  await ensureSeeded();
  const ip = getClientIp(req);
  const rl = rateLimit(`key-verify:${ip}`, 30, 60_000);
  if (!rl.allowed) return fail(`Too many attempts. Retry in ${rl.retryAfterSec}s.`, 429);

  const header = req.headers.get("authorization") || "";
  const raw = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!raw) return fail("Missing Authorization: Bearer <vx_live_...> header", 401);

  const key = await db.apiKey.findUnique({ where: { keyHash: sha256(raw) } });
  if (!key || key.status !== "ACTIVE") return fail("Invalid or revoked key", 401);

  await db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });

  const app = key.appId ? await db.app.findUnique({ where: { id: key.appId } }) : null;

  return ok({
    keyId: key.keyId,
    name: key.name,
    scopes: key.scopes.split(","),
    app: app ? { appId: app.appId, name: app.name } : null,
  });
}
