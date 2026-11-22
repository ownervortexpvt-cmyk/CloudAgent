/**
 * BUSINESS v2 — GET /api/auth/me → { user, plan, usage } for the signed-in user.
 * usage = live month-to-date counts (projects, runs, tokens) against the plan.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, UNAUTH_RESPONSE } from '@/lib/auth'
import { getPlan } from '@/lib/plans'
import { getControlFlags } from '@/lib/app-control'
import { bigBillionDayState } from '@/lib/bbd'

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

  // v116 — control-room visibility: every signed-in client learns about the
  // owner's announcement + BBD state from the SAME call it already makes.
  const flags = await getControlFlags()
  const bbd = bigBillionDayState(new Date(), flags.bbdOverride)

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id, email: user.email, name: user.name, role: user.role, plan: user.plan,
      planKind: user.planKind, planExpiresAt: user.planExpiresAt,
    },
    plan,
    usage: {
      projects,
      runs,
      tokens: (agg._sum.tokensIn || 0) + (agg._sum.tokensOut || 0),
      periodStart: monthStart.toISOString(),
    },
    platform: {
      announcement: flags.announcement,
      announcementLevel: flags.announcementLevel,
      aiRunsEnabled: flags.aiRunsEnabled,
      bigBillionDay: { active: bbd.active, endsAt: bbd.endsAt ?? null, nextAt: bbd.nextAt ?? null },
    },
  })
}
