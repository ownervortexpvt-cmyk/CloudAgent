/**
 * v110 — GET /api/billing/me → my plan state + payment history (last 25).
 * Used by Settings → Plan & Billing (payment history + expiry display).
 * v115 — also returns live Big Billion Day state so every account surface
 * (settings, welcome strip, paywall toasts) can show the same honest clock.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { getPlan } from '@/lib/plans'
import { bigBillionDayState, bigBillionDayCopy } from '@/lib/bbd'

export async function GET(req: NextRequest) {
  let user
  try {
    user = await requireUser(req)
  } catch (e: any) {
    if (e instanceof Response) return e
    throw e
  }

  const [payments, fresh] = await Promise.all([
    db.payment.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true, plan: true, kind: true, amount: true, currency: true,
        status: true, method: true, razorpayPaymentId: true,
        createdAt: true, paidAt: true,
      },
    }),
    db.authUser.findUnique({ where: { id: user.id }, select: { plan: true, planKind: true, planExpiresAt: true } }),
  ])

  const planKind = fresh?.planKind || 'free'
  const expiresAt = fresh?.planExpiresAt
  const expired = planKind === 'monthly' && expiresAt ? new Date(expiresAt as unknown as string).getTime() < Date.now() : false

  // v115 — Big Billion Day: the same pure clock the plan guards use, so the
  // client can never disagree with the server about the free window.
  const bbd = bigBillionDayState()

  return NextResponse.json({
    ok: true,
    plan: getPlan(fresh?.plan || user.plan),
    planKind,
    planExpiresAt: expiresAt || null,
    expired,
    // v111: lifetime is retired — `lifetime` stays as a legacy read-only flag
    // so any historical record still renders, but it can never be purchased.
    lifetime: planKind === 'lifetime',
    bigBillionDay: {
      active: bbd.active,
      endsAt: bbd.endsAt || null,
      nextAt: bbd.nextAt || null,
      message: bigBillionDayCopy(),
    },
    payments,
  })
}
