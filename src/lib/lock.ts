/**
 * Cloud Agent Lock — single-owner access control.
 *
 * The platform is used by ONE person (the owner). This lock makes sure
 * nobody else can open the builder in a browser without the owner's PIN.
 *
 * Storage (DB UserSetting KV):
 *   lock_hash    = scrypt hex "salt:hash" of the PIN/password
 *   lock_secret  = random 32B hex used to sign session cookies
 *
 * Session cookie: ca_lock = "v1.<expiryMs>.<hmac>"
 *   - httpOnly, SameSite=Lax, 30-day expiry
 *   - HMAC-SHA256 signed with lock_secret (verified in middleware)
 *
 * First run: no lock_hash in DB → /api/lock GET { configured:false } →
 * the lock screen shows SETUP mode (create the PIN). After that the same
 * screen only accepts the PIN (UNLOCK mode). The PIN can be changed later
 * (requires the current PIN) and the lock can be re-applied instantly
 * (logout clears the cookie).
 */
import crypto from 'crypto'

export const LOCK_COOKIE = 'ca_lock'
export const LOCK_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

/**
 * v25.1 — EMBEDDED-SAFE TOKEN CHANNEL.
 * When the builder is viewed inside an embedded preview (iframe on a
 * different origin, e.g. chat UI preview panels), browsers reject the
 * session cookie as a third-party cookie — the owner unlocks successfully
 * but the next navigation bounces straight back to /lock (observed live:
 * 9 successful unlocks in 26s, every one bounced). Fix: the lock APIs also
 * return the signed token in the JSON body, the browser keeps it in
 * localStorage (partitioned per origin — works everywhere, even where
 * third-party cookies are blocked) and sends it on every same-origin
 * request in the `x-ca-lock` header. The middleware accepts the token from
 * EITHER the cookie OR this header, with the identical HMAC + live-session
 * registry check, so security is unchanged.
 */
export const LOCK_HEADER = 'x-ca-lock'
/** Response header set on API 401s when a token was presented but is no
 *  longer valid (revoked / PIN rotated) — signals clients to drop it. */
export const LOCK_REVOKED_HEADER = 'x-ca-lock-revoked'

/** Token for a request: session cookie first, then the header channel.
 *  v138 FIX — this helper used to read ONLY the legacy `ca_lock` cookie,
 *  but BUSINESS v2 sessions live in the `ca_session` cookie. Every route
 *  that imported this helper (zip, firebase, r2vault, providers test,
 *  secrets test, internal tool) returned 401 "signed out" for normal
 *  cookie-only clients (plain downloads, curl, iframes) even when the
 *  caller was fully logged in. `ca_session` now wins first; the legacy
 *  cookie and the x-ca-lock header stay as fallback channels. */
export function tokenFromRequest(req: Request): string | undefined {
  const cookieHeader = req.headers.get('cookie') || ''
  const sm = cookieHeader.match(/(?:^|;\s*)ca_session=([^;]+)/)
  if (sm?.[1]) return sm[1]
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${LOCK_COOKIE}=([^;]+)`))
  if (m?.[1]) return m[1]
  const h = req.headers.get(LOCK_HEADER)
  return h && h.length > 8 ? h : undefined
}

function scryptHash(pin: string, salt?: string): string {
  const s = salt || crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(pin, s, 32).toString('hex')
  return `${s}:${hash}`
}

export function verifyPin(pin: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(':')
    const candidate = crypto.scryptSync(pin, salt, 32).toString('hex')
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'))
  } catch {
    return false
  }
}

export function hashPin(pin: string): string {
  return scryptHash(pin)
}

export function newSecret(): string {
  return crypto.randomBytes(32).toString('hex')
}

/** Pin length / strength rules — the owner picks a PIN of 4-64 chars. */
export function validatePin(pin: string): string | null {
  if (typeof pin !== 'string' || pin.trim().length < 4) return 'PIN must be at least 4 characters'
  if (pin.length > 64) return 'PIN must be at most 64 characters'
  return null
}

export function signToken(secret: string, now = Date.now()): string {
  const expiry = now + LOCK_TTL_MS
  const payload = `v1.${expiry}`
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}.${mac}`
}

export function verifyToken(token: string | undefined | null, secret: string): boolean {
  if (!token || !secret) return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [v, expiryStr, mac] = parts
  if (v !== 'v1') return false
  const expiry = parseInt(expiryStr, 10)
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false
  const expected = crypto.createHmac('sha256', secret).update(`${v}.${expiryStr}`).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

/**
 * v50.1 — OWNER RECOVERY.
 * The lock previously had a single failure mode that could permanently brick
 * the builder for its rightful owner: if the stored PIN stops matching what
 * the owner remembers (DB restored to an older snapshot, PIN rotated on a
 * device that later vanished…), there was NO way back in — every unlock
 * returned "Wrong PIN" forever. The recovery key is a long random string the
 * owner received through his private assistant chat; possession of it IS the
 * owner identity proof (the chat is behind his account login).
 *
 * Two channels hold the verification material so a single reset cannot kill
 * both: the CA_OWNER_RECOVERY_KEY env var AND the sha256 mirror in
 * UserSetting("recovery_hash"). Matching is constant-time on the digests.
 */
export const RECOVERY_HASH_KEY = 'recovery_hash'

export function hashRecoveryKey(key: string): string {
  return crypto.createHash('sha256').update(String(key || '')).digest('hex')
}

/** Constant-time recovery-key check against one stored sha256 hex. */
function matchesRecoveryHash(key: string, storedSha256Hex: string): boolean {
  try {
    const candidate = Buffer.from(hashRecoveryKey(key), 'hex')
    const stored = Buffer.from(storedSha256Hex, 'hex')
    if (candidate.length !== stored.length) return false
    return crypto.timingSafeEqual(candidate, stored)
  } catch {
    return false
  }
}

/** True when the presented key matches the env var OR the DB mirror. */
export async function verifyRecoveryKey(key: string): Promise<boolean> {
  const k = String(key || '').trim()
  if (k.length < 16) return false
  const { db } = await import('@/lib/db')
  const envKey = (process.env.CA_OWNER_RECOVERY_KEY || '').trim()
  if (envKey && matchesRecoveryHash(k, hashRecoveryKey(envKey))) return true
  const stored = (await db.userSetting.findUnique({ where: { key: RECOVERY_HASH_KEY } }).catch(() => null))?.value
  if (stored && matchesRecoveryHash(k, String(stored))) return true
  return false
}

/**
 * Paths that stay reachable without the lock. Everything else (pages +
 * APIs) requires the signed cookie.
 *  - /api/lock/*            the lock screen itself (setup/unlock/change)
 *  - /api/custom-domains/lookup  called by the external gateway to route
 *                           published sites — must stay open or live URLs break
 *  - /api/analytics/hit     anonymous beacons from published sites
 *  - /api/internal/*        platform MCP bridge (loopback + bearer token of its own)
 *  - /_next/*, favicon      static assets
 */
export const LOCK_PUBLIC_PATHS = [
  '/api/lock',
  '/api/custom-domains/lookup',
  '/api/analytics/hit',
  '/api/internal/',
  // v102: full-project zip download — public PATH but never open access: the
  // route itself demands a 24h one-active token (?token=) OR normal lock auth.
  // Exists so a plain browser LINK can download the backup (links can't send
  // the x-ca-lock header). Fail-closed 401 without one of the two.
  '/api/backup-download',
  '/lock',
  // builder PWA assets — the browser fetches these on every page (incl. the
  // lock screen); they contain no owner data
  '/manifest.webmanifest',
  '/sw-builder.js',
  '/icon.svg',
  '/logo.svg',
  '/builder-icon-512.png',
  '/builder-icon-192.png',
  '/builder-icon-180.png',
]

export function isPublicPath(pathname: string): boolean {
  // v67 SECURITY FIX: the old check had a bare `pathname.startsWith(p)`
  // clause that turned the allowlist into a prefix free-for-all —
  // '/api/lockXYZ' and '/api/internal-anything' were PUBLIC. Now each entry
  // matches itself exactly or as a real path-segment prefix ('/api/lock'
  // covers /api/lock/passkey but NOT /api/lockxyz).
  return LOCK_PUBLIC_PATHS.some(p => {
    const base = p.endsWith('/') ? p.slice(0, -1) : p
    return pathname === base || pathname.startsWith(base + '/')
  })
}

// ─── v25: in-route auth + session registry ───────────────────────────────────
// Routes under /api/lock* are PUBLIC (middleware skips them) but mutating
// sub-actions (passkey registration, session list) must themselves verify the
// caller's cookie. Kept here so every route shares one implementation.

export function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}

export function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'local').split(',')[0].trim() || 'local'
}

/** True when the request carries a valid session (cookie OR v25.1 header token).
 *  BUSINESS v2: now delegates to the multi-tenant AuthUser session registry —
 *  the six routes that call this directly keep their exact call sites. */
export async function isUnlockedRequest(req: Request): Promise<boolean> {
  try {
    const { verifySession } = await import('@/lib/auth')
    const cookieHeader = req.headers.get('cookie') || ''
    const m = cookieHeader.match(/(?:^|;\s*)ca_session=([^;]+)/)
    const token = m?.[1] || req.headers.get('x-ca-lock') || ''
    if (!token) return false
    return !!(await verifySession(token))
  } catch {
    return false
  }
}

/** Human-readable device label from the User-Agent. */
export function parseDevice(ua: string): string {
  const u = ua || ''
  const browser = /Edg\//.test(u) ? 'Edge' : /OPR\//.test(u) ? 'Opera' : /SamsungBrowser/.test(u) ? 'Samsung Internet' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'Browser'
  const os = /Android/.test(u) ? 'Android' : /iPhone|iPad|iPod/.test(u) ? 'iOS' : /Windows/.test(u) ? 'Windows' : /Mac OS X/.test(u) ? 'macOS' : /Linux/.test(u) ? 'Linux' : 'Device'
  return `${browser} on ${os}`
}

/** Record (or refresh) the session registry row for a freshly issued cookie.
 * v100 — opportunistic housekeeping: while we are already writing here,
 * sessions idle for 30+ days are swept so the registry cannot grow
 * unbounded across months of unlocks and E2E runs. Swept rows are dead
 * browsers (a session is refreshed on every authenticated request, so any
 * session in active use stays fresh); sweeping never blocks the unlock. */
export async function registerSessionForToken(req: Request, token: string): Promise<void> {
  try {
    const { db } = await import('@/lib/db')
    const tokenHash = sha256Hex(token)
    const device = parseDevice(req.headers.get('user-agent') || '')
    const ip = clientIp(req)
    await db.lockSession.upsert({
      where: { tokenHash },
      update: { lastSeenAt: new Date(), device, ip },
      create: { tokenHash, device, ip },
    })
    const staleCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    await db.lockSession.deleteMany({ where: { lastSeenAt: { lt: staleCutoff } } }).catch(() => {})
  } catch {
    // registry failure must never block a successful unlock
  }
}
