/**
 * BUSINESS v2 — POST /api/auth/login  { email, password } → session token.
 * Mirrors the old lock-unlock response shape ({ ok, token }) so the frontend
 * redirect flow and LockTokenBridge keep working unchanged.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createSession, sessionCookieHeader, verifyPassword } from '@/lib/auth'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'

export async function POST(req: NextRequest) {
  // v115 ultra-security: brute-force guard (10/min/ip)
  const rl = rateLimit(req, 'auth-login', 20)
  if (!rl.ok) return rateLimitResponse(rl) as any

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const email = String(body?.email || '').trim().toLowerCase()
  const password = String(body?.password || '')
  if (!email || !password) {
    return NextResponse.json({ ok: false, error: 'Email and password are required.' }, { status: 400 })
  }

  const user = await db.authUser.findUnique({ where: { email } })
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ ok: false, error: 'Wrong email or password.' }, { status: 401 })
  }
  if (user.status !== 'active') {
    return NextResponse.json({ ok: false, error: 'This account is suspended. Please contact support.' }, { status: 403 })
  }

  await db.authUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {})
  const device = (req.headers.get('user-agent') || 'Unknown device').slice(0, 120)
  const ip = (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '').split(',')[0].trim()
  const { token, expiresAt } = await createSession(user.id, device, ip)

  const res = NextResponse.json({
    ok: true,
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, plan: user.plan },
    isAdmin: user.role === 'admin',
  })
  res.headers.append('Set-Cookie', sessionCookieHeader(token, expiresAt))
  return res
}
