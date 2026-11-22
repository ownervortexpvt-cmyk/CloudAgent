/**
 * BUSINESS v2 — POST /api/auth/register
 * { name, email, password } → creates the account, signs in, returns session.
 * The FIRST registered account becomes the admin (and sits on Ultra Pro Max).
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createSession, hashPassword, sessionCookieHeader } from '@/lib/auth'
import { getPlan } from '@/lib/plans'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { getControlFlags } from '@/lib/app-control'
import { applyReferral, ensureReferralCode } from '@/lib/referral'
import { sendEmail, tplWelcome } from '@/lib/email'

export async function POST(req: NextRequest) {
  // v115 ultra-security: account-spam guard (5/min/ip)
  const rl = rateLimit(req, 'auth-register', 8)
  if (!rl.ok) return rateLimitResponse(rl) as any

  // v116 — control-room kill-switch: the owner can close registrations.
  // The FIRST account (owner bootstrap) is always allowed through, even when
  // signups are closed — a fresh DB must never lock its own owner out.
  const flags = await getControlFlags()
  if (!flags.signupsEnabled && (await db.authUser.count()) > 0) {
    return NextResponse.json(
      { ok: false, error: 'New registrations are temporarily closed. If you already have an account, please sign in — otherwise contact support.' },
      { status: 403 }
    )
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const name = String(body?.name || '').trim().slice(0, 80)
  const email = String(body?.email || '').trim().toLowerCase()
  const password = String(body?.password || '')

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: 'Please enter a valid email address.' }, { status: 400 })
  }
  if (password.length < 6) {
    return NextResponse.json({ ok: false, error: 'Password must be at least 6 characters.' }, { status: 400 })
  }

  const existing = await db.authUser.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ ok: false, error: 'This email is already registered — please sign in.' }, { status: 409 })
  }

  const total = await db.authUser.count()
  const isFirst = total === 0
  const role = isFirst ? 'admin' : 'user'
  const plan = isFirst ? 'ultra_pro_max' : 'free'
  if (isFirst) {
    // The owner/admin bootstraps the business on the top plan.
    getPlan(plan) // sanity: plan id must exist
  }

  const user = await db.authUser.create({
    data: {
      email,
      name: name || email.split('@')[0],
      passwordHash: hashPassword(password),
      role,
      plan,
      planStartedAt: new Date(),
      lastLoginAt: new Date(),
    },
  })

  // v119 REFER & EARN — every account gets a personal invite code, and a
  // valid ?ref=CODE at signup pays BOTH sides (7 days of Pro each side).
  // An invalid code never breaks the signup — it is simply ignored.
  const referralCode = await ensureReferralCode(user.id)
  const referral = await applyReferral(user.id, body?.ref)

  // v134 — welcome email (outbox-first: sends instantly once SMTP is set,
  // otherwise waits queued in the admin Email panel — never blocks signup)
  try {
    await sendEmail({
      to: user.email,
      userId: user.id,
      kind: 'welcome',
      ...tplWelcome(user.name || user.email.split('@')[0]),
    })
  } catch { /* email must never break registration */ }

  const device = (req.headers.get('user-agent') || 'Unknown device').slice(0, 120)
  const ip = (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '').split(',')[0].trim()
  const { token, expiresAt } = await createSession(user.id, device, ip)

  const res = NextResponse.json({
    ok: true,
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, plan: user.plan },
    isAdmin: role === 'admin',
    referral: {
      applied: referral.applied,
      referrerName: referral.referrerName || null,
      myCode: referralCode,
    },
  })
  res.headers.append('Set-Cookie', sessionCookieHeader(token, expiresAt))
  return res
}
