/**
 * v119 — GET /api/referral/lookup?ref=CODE → public, anonymous check of an
 * invite code for the login-screen banner ("Rahul invited you — you both get
 * 7 days of Pro free"). Leaks NOTHING but a masked first name; unknown codes
 * 404 quietly; rate-limited so it can't be enumerated at speed.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { maskName, normalizeReferralCode, REWARD_DAYS, REWARD_PLAN } from '@/lib/referral'
import { getPlan } from '@/lib/plans'

export async function GET(req: NextRequest) {
  const rl = rateLimit(req, 'referral-lookup', 30)
  if (!rl.ok) return rateLimitResponse(rl) as any

  const code = normalizeReferralCode(new URL(req.url).searchParams.get('ref'))
  if (!code) return NextResponse.json({ ok: false, error: 'missing code' }, { status: 400 })

  const referrer = await db.authUser.findUnique({
    where: { referralCode: code },
    select: { name: true, email: true, status: true },
  })
  if (!referrer || referrer.status !== 'active') {
    return NextResponse.json({ ok: false, error: 'unknown code' }, { status: 404 })
  }

  const plan = getPlan(REWARD_PLAN)
  return NextResponse.json({
    ok: true,
    referrerName: maskName(referrer.name, referrer.email),
    rewardDays: REWARD_DAYS,
    rewardPlan: plan.name,
  })
}
