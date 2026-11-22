/**
 * BUSINESS v2 — plan endpoints.
 *  GET  /api/auth/plan              → my plan + limits + live usage
 *  POST /api/auth/plan (ADMIN)      { userId, plan } → activate a plan
 *                                   after the owner confirms UPI payment (PhonePe / GPay / Paytm).
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, requireAdmin, UNAUTH_RESPONSE, invalidateSessionCache } from '@/lib/auth'
import { requireAdminUnlocked } from '@/lib/admin-lock'
import { PLANS, getPlan } from '@/lib/plans'

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return UNAUTH_RESPONSE()
  const plan = getPlan(user.plan)
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
  const [projects, runs, agg] = await Promise.all([
    db.project.count({ where: { userId: user.id, deletedAt: null } }),
    db.agentRun.count({ where: { project: { userId: user.id }, createdAt: { gte: monthStart } } }),
    db.agentRun.aggregate({
      _sum: { tokensIn: true, tokensOut: true },
      where: { project: { userId: user.id }, createdAt: { gte: monthStart } },
    }),
  ])
  return NextResponse.json({
    ok: true,
    plan,
    usage: { projects, runs, tokens: (agg._sum.tokensIn || 0) + (agg._sum.tokensOut || 0) },
    plans: Object.values(PLANS),
  })
}

export async function POST(req: NextRequest) {
  try {
    // v113: manual plan activation moves behind the control-room PIN —
    // the locked /admin room (or its header token) must be unlocked.
    await requireAdminUnlocked(req)
  } catch (e: any) {
    if (e instanceof Response) return e
    throw e
  }
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }
  const userId = String(body?.userId || '')
  const planId = String(body?.plan || '')
  if (!userId || !getPlan(planId) || (planId !== 'free' && !(planId in PLANS))) {
    return NextResponse.json({ ok: false, error: 'userId and a valid plan are required.' }, { status: 400 })
  }
  const target = await db.authUser.findUnique({ where: { id: userId } })
  if (!target) return NextResponse.json({ ok: false, error: 'User not found.' }, { status: 404 })

  await db.authUser.update({
    where: { id: userId },
    data: { plan: planId, planStartedAt: planId === 'free' ? null : new Date() },
  })
  invalidateSessionCache() // v116 — cached sessions must see the new plan NOW
  return NextResponse.json({ ok: true, userId, plan: planId })
}
