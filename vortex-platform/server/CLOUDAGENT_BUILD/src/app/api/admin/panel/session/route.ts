/**
 * ADMIN CONTROL ROOM — session endpoints (v113)
 *
 * GET    → { configured, locked, expiresAt } (any signed-in admin)
 * POST   { pin }                             → unlock (sets cookie + returns header token)
 * POST   { action:'change_pin', currentPin, nextPin } → rotate the owner PIN
 * DELETE → lock the control room now (clears cookie)
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireAdmin } from '@/lib/auth'
import {
  ADMIN_LOCK_TTL_MS,
  adminClearCookieHeader,
  adminUnlockCookieHeader,
  ensureAdminLockConfigured,
  hashAdminPin,
  isAdminUnlocked,
  setAdminSetting,
  signAdminToken,
  verifyAdminPin,
} from '@/lib/admin-lock'

async function guardAdmin(req: NextRequest): Promise<NextResponse | null> {
  try {
    await requireAdmin(req)
    return null
  } catch (e: any) {
    if (e instanceof Response) return e as any
    throw e
  }
}

export async function GET(req: NextRequest) {
  const denied = await guardAdmin(req)
  if (denied) return denied
  const { hash } = await ensureAdminLockConfigured()
  const state = await isAdminUnlocked(req)
  return NextResponse.json({
    ok: true,
    configured: Boolean(hash),
    locked: !state.ok,
    expiresAt: state.expiresAt ?? null,
  })
}

export async function POST(req: NextRequest) {
  const denied = await guardAdmin(req)
  if (denied) return denied

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  if (body?.action === 'change_pin') {
    // Rotating the PIN requires the control room to be unlocked AND the current PIN.
    const unlocked = await isAdminUnlocked(req)
    if (!unlocked.ok) {
      return NextResponse.json({ ok: false, error: 'Control room is locked — unlock first.' }, { status: 401 })
    }
    const currentPin = String(body?.currentPin || '')
    const nextPin = String(body?.nextPin || '')
    if (nextPin.trim().length < 6 || nextPin.length > 128) {
      return NextResponse.json({ ok: false, error: 'New PIN must be 6-128 characters.' }, { status: 400 })
    }
    const { hash } = await ensureAdminLockConfigured()
    if (!verifyAdminPin(currentPin, hash)) {
      return NextResponse.json({ ok: false, error: 'Current PIN is wrong.' }, { status: 403 })
    }
    await setAdminSetting('admin_lock_hash', hashAdminPin(nextPin))
    // Rotate the signing secret so every previously-issued unlock token dies
    // with the PIN it was issued under (all devices re-lock instantly).
    await setAdminSetting('admin_lock_secret', crypto.randomBytes(32).toString('hex'))
    return NextResponse.json({ ok: true, changed: true, allTokensRevoked: true })
  }

  // Default action: unlock with the PIN.
  const pin = String(body?.pin || '')
  if (!pin) return NextResponse.json({ ok: false, error: 'PIN required' }, { status: 400 })
  const { hash, secret } = await ensureAdminLockConfigured()
  if (!verifyAdminPin(pin, hash)) {
    return NextResponse.json({ ok: false, error: 'Wrong PIN.' }, { status: 403 })
  }
  const expiresAt = Date.now() + ADMIN_LOCK_TTL_MS
  const token = signAdminToken(secret, expiresAt)
  const res = NextResponse.json({ ok: true, unlocked: true, expiresAt, token })
  res.headers.append('Set-Cookie', adminUnlockCookieHeader(token, expiresAt))
  return res
}

export async function DELETE(req: NextRequest) {
  const denied = await guardAdmin(req)
  if (denied) return denied
  // "Lock now" locks EVERYWHERE: rotate the signing secret so every
  // outstanding unlock token (cookie + header channel) dies instantly —
  // stateless HMAC alone could never be revoked before its 12h expiry.
  const { setAdminSetting } = await import('@/lib/admin-lock')
  await setAdminSetting('admin_lock_secret', crypto.randomBytes(32).toString('hex'))
  const res = NextResponse.json({ ok: true, locked: true, lockedEverywhere: true })
  res.headers.append('Set-Cookie', adminClearCookieHeader)
  return res
}
