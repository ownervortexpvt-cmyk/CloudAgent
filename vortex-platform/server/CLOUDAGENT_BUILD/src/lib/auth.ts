/**
 * BUSINESS v2 — multi-tenant user auth (replaces the single-owner PIN lock).
 *
 * Sessions ride the SAME two channels the lock used, so the entire frontend
 * fetch layer keeps working untouched:
 *   1. `ca_session` httpOnly cookie (normal top-level browsers)
 *   2. `x-ca-lock` header (LockTokenBridge — embedded previews where
 *      third-party cookies are dropped; token persisted in localStorage)
 *
 * Token shape: `v2.<userId>.<expiresAtMs>.<hmac>` — HMAC-SHA256 signed with
 * the per-installation secret (UserSetting 'session_secret', auto-minted).
 * The token must ALSO exist in the revocable AuthSession registry (sign out
 * everywhere, suspension, expiry) — fail closed, same discipline as the lock.
 */
import crypto from 'crypto'
import fs from 'fs'
import { NextRequest } from 'next/server'

export const SESSION_COOKIE = 'ca_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

const SESSION_SECRET_KEY = 'session_secret'
const REVOKED_HEADER = 'x-ca-lock-revoked' // same header the bridge already watches

export type SessionUser = {
  id: string
  email: string
  name: string
  role: string // 'user' | 'admin'
  plan: string // EFFECTIVE plan — expired monthly subscriptions read as 'free'
  planKind: string // 'free' | 'monthly' | 'lifetime' | 'admin'
  planExpiresAt: string | null // ISO when monthly, null otherwise
  status: string
}

/* ─── secrets ─── */

async function getSessionSecret(): Promise<string> {
  const { db } = await import('@/lib/db')
  const existing = await db.userSetting.findUnique({ where: { key: SESSION_SECRET_KEY } }).catch(() => null)
  if (existing?.value) return existing.value
  const secret = crypto.randomBytes(32).toString('hex')
  await db.userSetting.create({ data: { key: SESSION_SECRET_KEY, value: secret } }).catch(async () => {
    // concurrent boot race — re-read
    const again = await db.userSetting.findUnique({ where: { key: SESSION_SECRET_KEY } })
    return again
  })
  return secret
}

/* ─── passwords (scrypt, no external deps) ─── */

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = String(stored).split(':')
    if (!salt || !hash) return false
    const candidate = crypto.scryptSync(String(password), salt, 64)
    const expected = Buffer.from(hash, 'hex')
    if (candidate.length !== expected.length) return false
    return crypto.timingSafeEqual(candidate, expected)
  } catch {
    return false
  }
}

/* ─── token sign / verify ─── */

export function sha256Hex(v: string): string {
  return crypto.createHash('sha256').update(String(v)).digest('hex')
}

async function signToken(userId: string, expiresAtMs: number): Promise<string> {
  const secret = await getSessionSecret()
  const mac = crypto.createHmac('sha256', secret).update(`${userId}.${expiresAtMs}`).digest('hex')
  return `v2.${userId}.${expiresAtMs}.${mac}`
}

function parseToken(token: string): { userId: string; expiresAtMs: number } | null {
  const parts = String(token || '').split('.')
  if (parts.length !== 4 || parts[0] !== 'v2') return null
  const [, userId, exp, mac] = parts
  const expiresAtMs = Number(exp)
  if (!userId || !Number.isFinite(expiresAtMs) || !mac) return null
  return { userId, expiresAtMs }
}

/* ─── session CRUD ─── */

export async function createSession(userId: string, device: string, ip: string): Promise<{ token: string; expiresAt: Date }> {
  const { db } = await import('@/lib/db')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  const token = await signToken(userId, expiresAt.getTime())
  await db.authSession.create({ data: { tokenHash: sha256Hex(token), userId, device: device.slice(0, 120), ip: ip.slice(0, 60), expiresAt } })
  return { token, expiresAt }
}

/** Verify + resolve the session user. Returns null when anything is off (fail closed). */
export async function verifySession(token: string | undefined | null): Promise<SessionUser | null> {
  const parsed = parseToken(String(token || ''))
  if (!parsed) return null
  if (parsed.expiresAtMs < Date.now()) return null
  const secret = await getSessionSecret()
  const expected = crypto.createHmac('sha256', secret).update(`${parsed.userId}.${parsed.expiresAtMs}`).digest('hex')
  try {
    if (!crypto.timingSafeEqual(Buffer.from(macOf(String(token)), 'hex'), Buffer.from(expected, 'hex'))) return null
  } catch {
    return null
  }
  const tokenHash = sha256Hex(String(token))
  // v116 — ULTRA SPEED: verified sessions are cached in-process for 45s.
  // EVERY request (middleware + route) used to cost 2 DB reads; hot pages
  // fire 5-15 parallel calls, so SQLite became the latency floor.
  // Correctness guard: each cache entry stamps the DB file's mtime — ANY
  // write (API, direct sqlite, another process) bumps mtime → instant cold
  // read. Revocations bump rev → instant kill. Expiry/lapse/plan semantics
  // stay EXACTLY as before, reads just stop hitting SQLite on quiet paths.
  const cache = sessionCache()
  const stamp = dbStamp()
  const hit = cache.map.get(tokenHash)
  if (hit && cache.rev === hit.rev && stamp === hit.stamp && Date.now() - hit.at < SESS_TTL_MS) {
    hit.at = Date.now()
    return hit.user
  }
  const { db } = await import('@/lib/db')
  const session = await db.authSession.findUnique({ where: { tokenHash } }).catch(() => null)
  if (!session) return null // revoked / signed out / registry wiped
  const user = await db.authUser.findUnique({ where: { id: session.userId } }).catch(() => null)
  if (!user || user.status !== 'active') return null
  // refresh last-seen at most once per minute (avoid a write per request)
  if (Date.now() - new Date(session.lastSeenAt).getTime() > 60_000) {
    await db.authSession.update({ where: { tokenHash: session.tokenHash }, data: { lastSeenAt: new Date() } }).catch(() => {})
  }
  // v110: a lapsed monthly subscription drops back to the free plan here —
  // the single choke point every route and the middleware read the plan from.
  const planKind = user.planKind || 'free'
  const rawExpiry = user.planExpiresAt ? new Date(user.planExpiresAt as unknown as string) : null
  const expired = planKind === 'monthly' && rawExpiry !== null && rawExpiry.getTime() < Date.now()
  const sessionUser: SessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    plan: expired ? 'free' : user.plan,
    planKind,
    planExpiresAt: rawExpiry ? rawExpiry.toISOString() : null,
    status: user.status,
  }
  if (cache.map.size > 800) cache.map.clear() // hard memory cap
  cache.map.set(tokenHash, { user: sessionUser, at: Date.now(), rev: cache.rev, stamp })
  return sessionUser
}

function macOf(token: string): string {
  const parts = token.split('.')
  return parts[3] || ''
}

/* ─── v116 — in-process verified-session cache (see verifySession) ─── */
const SESS_TTL_MS = 45_000
type SessEntry = { user: SessionUser; at: number; rev: number; stamp: number }
type SessCacheShape = { map: Map<string, SessEntry>; rev: number }
const sessG = globalThis as unknown as { __caSessCache?: SessCacheShape }
function sessionCache(): SessCacheShape {
  if (!sessG.__caSessCache) sessG.__caSessCache = { map: new Map(), rev: 0 }
  return sessG.__caSessCache
}
/** Max mtime of the SQLite db + its WAL/SHM siblings. ANY committed write
 * (from any process — Prisma or raw sqlite3) lands in the -wal file and
 * bumps mtime, so a changed stamp = something changed = cold read. */
const sessG2 = globalThis as unknown as { __caDbStampPaths?: string[]; __caDbStampAt?: number }
function dbStamp(): number {
  try {
    if (!sessG2.__caDbStampPaths) {
      const root = process.env.PROJECT_ROOT || '/home/z/my-project'
      const base = process.env.DATABASE_URL?.replace(/^file:/, '') || 'db/custom.db'
      const abs = base.startsWith('/') ? base : `${root}/${base}`
      sessG2.__caDbStampPaths = [abs, `${abs}-wal`, `${abs}-shm`]
    }
    let m = 0
    for (const p of sessG2.__caDbStampPaths) {
      try { const s = fs.statSync(p); if (s.mtimeMs > m) m = s.mtimeMs } catch { /* sibling missing */ }
    }
    return m
  } catch {
    return 0 // stat unavailable → never cache (always cold, always correct)
  }
}
/** Kill EVERY cached verification — call after any revocation (logout,
 * password change, admin ban, session wipe). Revocations are rare; the next
 * request re-verifies from the DB once and the cache re-warms. */
export function invalidateSessionCache(): void {
  if (sessG.__caSessCache) sessG.__caSessCache.rev++
}

export async function revokeSession(token: string): Promise<void> {
  invalidateSessionCache()
  const { db } = await import('@/lib/db')
  await db.authSession.deleteMany({ where: { tokenHash: sha256Hex(token) } }).catch(() => {})
}

export async function revokeAllSessions(userId: string): Promise<void> {
  invalidateSessionCache()
  const { db } = await import('@/lib/db')
  await db.authSession.deleteMany({ where: { userId } }).catch(() => {})
}

/* ─── request helpers (routes) ─── */

export function tokenFromRequest(req: NextRequest): string | undefined {
  const header = req.headers.get('x-ca-lock')
  if (header) return header
  return req.cookies.get(SESSION_COOKIE)?.value
}

/** The authenticated user for this request, or null. */
export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  return verifySession(tokenFromRequest(req))
}

export const UNAUTH_RESPONSE = () =>
  Response.json({ ok: false, error: 'signed out — please log in' }, { status: 401, headers: { [REVOKED_HEADER]: '1' } })

export const FORBIDDEN_RESPONSE = () =>
  Response.json({ ok: false, error: 'this project belongs to another account' }, { status: 403 })

/** Require an authenticated user inside an API route. Throws a 401 Response. */
export async function requireUser(req: NextRequest): Promise<SessionUser> {
  const user = await getSessionUser(req)
  if (!user) throw UNAUTH_RESPONSE()
  return user
}

/** Require an admin. Throws 401/403. */
export async function requireAdmin(req: NextRequest): Promise<SessionUser> {
  const user = await requireUser(req)
  if (user.role !== 'admin') throw Response.json({ ok: false, error: 'admin access required' }, { status: 403 })
  return user
}

/** Assert the caller may touch this project (owner or admin). Throws on violation. */
export async function requireProjectAccess(req: NextRequest, projectId: string): Promise<SessionUser> {
  const user = await requireUser(req)
  if (user.role === 'admin') return user
  const { db } = await import('@/lib/db')
  const project = await db.project.findUnique({ where: { id: projectId }, select: { userId: true } }).catch(() => null)
  if (project && project.userId === user.id) return user
  // v123 COLLABORATION — an ACTIVE collaborator gets the same access as the
  // owner for build/edit/run flows (invites/removal stay owner-only, enforced
  // in the collab route itself).
  if (project) {
    const coll = await db.projectCollaborator.findUnique({
      where: { projectId_userId: { projectId, userId: user.id } },
    }).catch(() => null)
    if (coll && coll.status === 'active') return user
  }
  throw FORBIDDEN_RESPONSE()
}

/**
 * v123 — owner-ONLY assertion (admins exempt). For destructive actions a
 * collaborator must NEVER be able to do: deleting the project itself.
 * Collaboration grants edit/build/run — never teardown.
 */
export async function requireProjectOwner(req: NextRequest, projectId: string): Promise<SessionUser> {
  const user = await requireUser(req)
  if (user.role === 'admin') return user
  const { db } = await import('@/lib/db')
  const project = await db.project.findUnique({ where: { id: projectId }, select: { userId: true } }).catch(() => null)
  if (!project || project.userId !== user.id) throw FORBIDDEN_RESPONSE()
  return user
}

/* ─── session cookie setter (login/register responses) ─── */

export function sessionCookieHeader(token: string, expiresAt: Date): string {
  // httpOnly would break nothing here, but the bridge keeps the header channel
  // for embedded contexts; cookie stays SameSite=Lax so top-level flows work.
  return `${SESSION_COOKIE}=${token}; Path=/; Expires=${expiresAt.toUTCString()}; SameSite=Lax`
}
