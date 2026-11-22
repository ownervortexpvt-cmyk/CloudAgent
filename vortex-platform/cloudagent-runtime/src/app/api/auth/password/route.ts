/**
 * BUSINESS v2 — POST /api/auth/password  { currentPassword, newPassword }.
 * Changes the signed-in user's password and revokes every other session.
 *
 * v115 FIX: the old flow revoked ALL sessions and minted a fresh one but
 * never delivered its token — the current device was silently logged out
 * right after changing the password (owner: password change from the admin
 * panel kicked him to the login screen). Now the new session token is set
 * as the ca_session cookie on THIS response, so the device that changed the
 * password stays signed in; every other device is revoked for real.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createSession, getSessionUser, hashPassword, revokeAllSessions, sessionCookieHeader, tokenFromRequest, UNAUTH_RESPONSE, verifyPassword } from '@/lib/auth'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'

export async function POST(req: NextRequest) {
  // v115 ultra-security: credential-stuffing guard on password change (6/min/ip)
  const rl = rateLimit(req, 'auth-password', 6)
  if (!rl.ok) return rateLimitResponse(rl) as any

  const user = await getSessionUser(req)
  if (!user) return UNAUTH_RESPONSE()

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const current = String(body?.currentPassword || '')
  const next = String(body?.newPassword || '')
  if (next.length < 6) {
    return NextResponse.json({ ok: false, error: 'New password must be at least 6 characters.' }, { status: 400 })
  }

  const row = await db.authUser.findUnique({ where: { id: user.id } })
  if (!row || !verifyPassword(current, row.passwordHash)) {
    return NextResponse.json({ ok: false, error: 'Current password is wrong.' }, { status: 403 })
  }

  await db.authUser.update({ where: { id: user.id }, data: { passwordHash: hashPassword(next) } })
  // keep the current device signed in, kill everywhere else
  const keep = tokenFromRequest(req)
  await revokeAllSessions(user.id)
  const res = NextResponse.json({ ok: true })
  if (keep) {
    const device = (req.headers.get('user-agent') || 'Unknown device').slice(0, 120)
    const { token, expiresAt } = await createSession(user.id, device, '').catch(() => ({ token: '', expiresAt: new Date() }))
    if (token) res.headers.set('set-cookie', sessionCookieHeader(token, expiresAt))
  }
  return res
}
