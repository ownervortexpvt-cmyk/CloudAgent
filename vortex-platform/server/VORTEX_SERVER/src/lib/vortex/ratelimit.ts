/**
 * VORTEX CORE — in-memory sliding-window rate limiter.
 * Private control plane: single process, so memory map is enough.
 * (Future: swap the store for Redis when NETWORK phase lands.)
 */

type Hit = { count: number; resetAt: number };

const buckets = new Map<string, Hit>();

// periodic cleanup to avoid unbounded growth
let lastSweep = Date.now();
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, v] of buckets) {
    if (v.resetAt < now) buckets.delete(k);
  }
}

export type RateResult = { allowed: boolean; remaining: number; retryAfterSec: number };

export function rateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSec: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, remaining: limit - existing.count, retryAfterSec: 0 };
}

export function getClientIp(req: Request): string {
  const h = req.headers;
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") || "local";
}
