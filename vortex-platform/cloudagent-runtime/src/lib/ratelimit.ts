/**
 * v115 — ULTRA SECURITY: in-process sliding-window rate limiter.
 *
 * Single-node SQLite platform = in-memory is the CORRECT design (no Redis,
 * no external service — the platform stays standalone per the owner's rule).
 * Fixed-memory buckets (Map with max-size eviction) keyed by ip+scope.
 *
 * Applied to the money and identity endpoints:
 *   POST /api/auth/login     10 / min / ip   (brute force)
 *   POST /api/auth/register  5  / min / ip   (spam accounts)
 *   POST /api/auth/password  6  / min / ip   (credential-stuffing on change)
 *   POST /api/billing/order  12 / min / ip   (order spam)
 *   POST /api/billing/verify 20 / min / ip   (verify replay hammering)
 */

type Bucket = { hits: number[]; }

const buckets = new Map<string, Bucket>()
const MAX_KEYS = 10_000 // memory guard: evict stale keys beyond this

function bucketKey(scope: string, ip: string): string {
  return `${scope}:${ip}`
}

function clientIp(req: Request): string {
  const xf = req.headers.get('x-forwarded-for')
  if (xf) return xf.split(',')[0].trim()
  return req.headers.get('x-real-ip') || 'local'
}

export interface RateResult {
  ok: boolean
  remaining: number
  retryAfterSec: number
}

/**
 * Sliding window check. `limit` requests per `windowMs` per ip+scope.
 * Returns ok:false with a Retry-After hint when the window is full.
 */
export function rateLimit(req: Request, scope: string, limit: number, windowMs = 60_000): RateResult {
  const now = Date.now()
  const key = bucketKey(scope, clientIp(req))

  // memory guard — drop the oldest quarter when the map grows too large
  if (buckets.size > MAX_KEYS) {
    const drop = Math.floor(MAX_KEYS / 4)
    let i = 0
    for (const k of buckets.keys()) {
      buckets.delete(k)
      if (++i >= drop) break
    }
  }

  const b = buckets.get(key) || { hits: [] }
  b.hits = b.hits.filter((t) => now - t < windowMs)
  if (b.hits.length >= limit) {
    buckets.set(key, b)
    const oldest = b.hits[0] || now
    return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)) }
  }
  b.hits.push(now)
  buckets.set(key, b)
  return { ok: true, remaining: limit - b.hits.length, retryAfterSec: 0 }
}

/** 429 Response pre-built for the routes. */
export function rateLimitResponse(r: RateResult): Response {
  return Response.json(
    { ok: false, error: `Too many attempts — try again in ${r.retryAfterSec}s.` },
    { status: 429, headers: { 'Retry-After': String(r.retryAfterSec) } },
  )
}
