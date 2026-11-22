/**
 * ADMIN CONTROL ROOM LOCK (v113)
 *
 * The owner asked for ONE place where everything is controlled — and for
 * that place to be locked with its own PIN (100039161924486), separate
 * from the regular admin login. Even a stolen/active admin session cannot
 * touch payments, providers, users or toolchains without this second PIN.
 *
 * Storage (UserSetting KV — survives restarts, self-heals after a DB wipe):
 *   admin_lock_hash   scrypt "salt:hash" of the PIN
 *   admin_lock_secret random 32B hex used to sign unlock tokens
 *
 * Unlock token: "v1.<expiryMs>.<hmac>" delivered BOTH as an httpOnly cookie
 * (ca_admin_unlock) AND in the JSON body (x-ca-admin header channel) — the
 * same embedded-safe dual channel the old platform lock used, so the panel
 * also works inside iframe previews where third-party cookies are blocked.
 *
 * First run: no admin_lock_hash in DB → the DEFAULT owner PIN seeds itself
 * (only its scrypt hash is ever stored; the plaintext lives nowhere). The
 * owner can change the PIN from Admin → Security (needs the current PIN).
 */
import crypto from 'crypto'
import { db } from '@/lib/db'
import { requireAdmin, SessionUser } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

export const ADMIN_LOCK_COOKIE = 'ca_admin_unlock'
export const ADMIN_LOCK_HEADER = 'x-ca-admin'
export const ADMIN_LOCK_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours — control room re-locks itself twice a day

/** The owner's chosen PIN (set in chat). Only its scrypt hash is stored. */
export const ADMIN_DEFAULT_PIN = 'DCnTt8wwtuj3f6R'
/** v115 — the PIN this platform shipped with (migration source, below). */
export const ADMIN_LEGACY_PIN = '100039161924486'
/** v148 — the PREVIOUS owner PIN. A v2-versioned hash that still verifies
 * against THIS value is the un-personalised default → rotate to the new
 * owner PIN below. A custom PIN never matches and is left untouched. */
export const ADMIN_V2_LEGACY_PIN = '1000391619244862'

const SETTING_HASH = 'admin_lock_hash'
const SETTING_SECRET = 'admin_lock_secret'
const SETTING_VER = 'admin_lock_pin_ver'
/** Bump whenever ADMIN_DEFAULT_PIN changes → old unversioned hashes migrate. */
const PIN_VERSION = '3'

function scryptHash(pin: string, salt?: string): string {
  const s = salt || crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(pin, s, 32).toString('hex')
  return `${s}:${hash}`
}

export function verifyAdminPin(pin: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(':')
    const candidate = crypto.scryptSync(pin, salt, 32).toString('hex')
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'))
  } catch {
    return false
  }
}

export function hashAdminPin(pin: string): string {
  return scryptHash(pin)
}

async function getSetting(key: string): Promise<string | null> {
  const row = await db.userSetting.findUnique({ where: { key } })
  return row?.value ?? null
}

async function setSetting(key: string, value: string): Promise<void> {
  await db.userSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
}

/** Ensure both KV rows exist. Self-heals after sandbox/DB wipes. */
export async function ensureAdminLockConfigured(): Promise<{ hash: string; secret: string }> {
  let hash = await getSetting(SETTING_HASH)
  if (!hash) {
    hash = scryptHash(ADMIN_DEFAULT_PIN)
    await setSetting(SETTING_HASH, hash)
    await setSetting(SETTING_VER, PIN_VERSION)
  } else {
    // v115 PIN migration: a hash seeded before versioning exists only if it was
    // the ORIGINAL default. If it still verifies against the legacy PIN, the
    // owner never personalised it — rotate it to the new owner PIN. A custom
    // PIN (changed via Admin → Security) does NOT match the legacy PIN and is
    // therefore left untouched.
    const ver = await getSetting(SETTING_VER)
    if (!ver) {
      if (verifyAdminPin(ADMIN_LEGACY_PIN, hash)) {
        hash = scryptHash(ADMIN_DEFAULT_PIN)
        await setSetting(SETTING_HASH, hash)
      }
      await setSetting(SETTING_VER, PIN_VERSION)
    } else if (ver === '2') {
      // v149 migration: a v2-versioned hash that still verifies against the
      // OLD v2 default is the un-personalised owner PIN → rotate it to the
      // new owner PIN. A custom PIN (changed via Admin → Security from the
      // v2 default) does NOT match and is preserved — only the version moves.
      if (verifyAdminPin(ADMIN_V2_LEGACY_PIN, hash)) {
        hash = scryptHash(ADMIN_DEFAULT_PIN)
        await setSetting(SETTING_HASH, hash)
      }
      await setSetting(SETTING_VER, PIN_VERSION)
    }
  }
  let secret = await getSetting(SETTING_SECRET)
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex')
    await setSetting(SETTING_SECRET, secret)
  }
  return { hash, secret }
}

export function signAdminToken(secret: string, expiresAtMs: number): string {
  const mac = crypto.createHmac('sha256', secret).update(`admin-unlock.${expiresAtMs}`).digest('hex')
  return `v1.${expiresAtMs}.${mac}`
}

function verifyAdminToken(secret: string, token: string | undefined): boolean {
  if (!token || !token.startsWith('v1.')) return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const expiry = Number(parts[1])
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false
  const expected = crypto.createHmac('sha256', secret).update(`admin-unlock.${expiry}`).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(parts[2], 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

/** Token from cookie OR the x-ca-admin header (embedded-safe dual channel). */
function adminTokenFromRequest(req: NextRequest): string | undefined {
  const cookieHeader = req.headers.get('cookie') || ''
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${ADMIN_LOCK_COOKIE}=([^;]+)`))
  if (m?.[1]) return m[1]
  const h = req.headers.get(ADMIN_LOCK_HEADER)
  return h && h.length > 8 ? h : undefined
}

/** Is this request carrying a valid, unexpired unlock token? */
export async function isAdminUnlocked(req: NextRequest): Promise<{ ok: boolean; expiresAt?: number }> {
  const { secret } = await ensureAdminLockConfigured()
  const token = adminTokenFromRequest(req)
  if (!verifyAdminToken(secret, token)) return { ok: false }
  const expiry = Number(token!.split('.')[1])
  return { ok: true, expiresAt: expiry }
}

/**
 * Double gate for control-room APIs: admin session AND unlock token.
 * Throws a Response (401 not unlocked / 403 not admin) the route returns.
 */
export async function requireAdminUnlocked(req: NextRequest): Promise<SessionUser> {
  const admin = await requireAdmin(req) // throws 401/403 Response
  const unlocked = await isAdminUnlocked(req)
  if (!unlocked.ok) {
    throw NextResponse.json(
      { ok: false, error: 'Admin control room is locked. Unlock with the owner PIN at /admin.' },
      { status: 401 },
    )
  }
  return admin
}

export function adminUnlockCookieHeader(token: string, expiresAtMs: number): string {
  return `${ADMIN_LOCK_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor((expiresAtMs - Date.now()) / 1000)}`
}

export const adminClearCookieHeader = `${ADMIN_LOCK_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`

export { getSetting as getAdminSetting, setSetting as setAdminSetting }
