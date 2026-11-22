/**
 * BUSINESS v2 — plan enforcement guards (server-side truth).
 * Every metered entry point calls these BEFORE doing work:
 *   - assertProjectCreate(user)   → project count vs plan
 *   - assertRunAllowed(user)      → monthly runs + tokens vs plan (402 when over)
 *   - capSwarmAgents(user, n)     → clamp the army size to the plan
 * Admins (the SaaS operator) are exempt — the platform must never lock its
 * own owner out, even on a freshly-provisioned database where the admin
 * account starts on the free plan.
 *
 * v115 — BIG BILLION DAY: no standing free tier. On the 1st of every month
 * 08:00–12:00 IST, free accounts get Pro-level limits so anyone can build
 * during the monthly 4-hour open house (see lib/bbd.ts). Paid plans are
 * never touched — the boost applies only to plan 'free'.
 */
import { db } from '@/lib/db'
import { getPlan, PLANS, PlanDef } from '@/lib/plans'
import { bigBillionDayState } from '@/lib/bbd'
import { getControlFlags } from '@/lib/app-control'

/** v116 — the control room's BBD override decides over the raw clock. */
async function bbdActive(): Promise<boolean> {
  const { bbdOverride } = await getControlFlags()
  return bigBillionDayState(new Date(), bbdOverride).active
}

/** The plan this user effectively has right now (BBD boost included). */
async function effectivePlan(user: { plan: string }): Promise<PlanDef> {
  const plan = getPlan(user.plan)
  if (plan.id === 'free' && (await bbdActive())) return PLANS.pro
  return plan
}

export function monthStartUTC(): Date {
  return new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
}

async function usageFor(userId: string) {
  const monthStart = monthStartUTC()
  const [projects, runs, agg] = await Promise.all([
    db.project.count({ where: { userId, deletedAt: null } }),
    db.agentRun.count({ where: { project: { userId }, createdAt: { gte: monthStart } } }),
    db.agentRun.aggregate({
      _sum: { tokensIn: true, tokensOut: true },
      where: { project: { userId }, createdAt: { gte: monthStart } },
    }),
  ])
  return {
    projects,
    runs,
    tokens: (agg._sum.tokensIn || 0) + (agg._sum.tokensOut || 0),
  }
}

/**
 * v115 — BIG BILLION DAY model: there is NO standing free tier.
 * A 'free' account can sign in and look around, but building is only possible:
 *   - during the monthly Big Billion Day window (1st, 08:00–12:00 IST), OR
 *   - on a paid plan (₹1,999+/mo).
 * Outside the window the guards below return a friendly 402 that explains the
 * next window instead of a bare limit error.
 */
async function assertNotFreeOutsideBbd(user: { plan: string }): Promise<void> {
  if (user.plan !== 'free') return
  if (await bbdActive()) return // Pro-level boost during the window (or owner override)
  throw Response.json(
    {
      ok: false,
      error: 'Building is free on Big Billion Day — the 1st of every month, 8:00 AM to 12:00 PM IST. Until then, a plan (from ₹1,999/month) unlocks building right now.',
      plan: 'free',
      limit: 'big-billion-day',
    },
    { status: 402 }
  )
}

export async function assertProjectCreate(user: { id: string; plan: string; role?: string }): Promise<void> {
  if (user.role === 'admin') return // operator bypass
  await assertNotFreeOutsideBbd(user)
  const plan = await effectivePlan(user)
  const { projects } = await usageFor(user.id)
  if (plan.maxProjects >= 0 && projects >= plan.maxProjects) {
    throw Response.json(
      {
        ok: false,
        error: `Plan limit reached — ${plan.name} allows ${plan.maxProjects} project(s). Upgrade your plan to create more.`,
        plan: plan.id,
        limit: 'projects',
      },
      { status: 402 }
    )
  }
}

/**
 * v116 — GLOBAL RUN KILL-SWITCH (control room). When the owner pauses AI
 * runs (incident, cost spike, abuse) every non-admin run refuses politely.
 */
export async function assertRunsGloballyEnabled(user: { role?: string }): Promise<void> {
  if (user.role === 'admin') return
  const { aiRunsEnabled } = await getControlFlags()
  if (!aiRunsEnabled) {
    throw Response.json(
      {
        ok: false,
        error: 'The builder is paused by the CloudAgent team for a short maintenance window — please try again soon.',
        limit: 'runs-paused',
      },
      { status: 503 }
    )
  }
}

export async function assertRunAllowed(user: { id: string; plan: string; role?: string }): Promise<void> {
  if (user.role === 'admin') return // operator bypass
  await assertRunsGloballyEnabled(user)
  await assertNotFreeOutsideBbd(user)
  const plan = await effectivePlan(user)
  const { runs, tokens } = await usageFor(user.id)
  if (plan.maxRunsPerMonth >= 0 && runs >= plan.maxRunsPerMonth) {
    throw Response.json(
      {
        ok: false,
        error: `Plan limit reached — ${plan.name} allows ${plan.maxRunsPerMonth.toLocaleString()} AI run(s) per month (used ${runs}). Upgrade to keep building.`,
        plan: plan.id,
        limit: 'runs',
      },
      { status: 402 }
    )
  }
  if (plan.maxTokensPerMonth >= 0 && tokens >= plan.maxTokensPerMonth) {
    throw Response.json(
      {
        ok: false,
        error: `Plan limit reached — ${plan.name} includes ${(plan.maxTokensPerMonth / 1_000_000).toFixed(0)}M tokens per month. Upgrade to keep building.`,
        plan: plan.id,
        limit: 'tokens',
      },
      { status: 402 }
    )
  }
}

export async function capSwarmAgents(user: { id: string; plan: string; role?: string }, wanted: number): Promise<number> {
  if (user.role === 'admin') return Math.max(1, wanted) // operator bypass
  if (user.plan === 'free' && !(await bbdActive())) return 1 // no building outside BBD anyway
  const plan = await effectivePlan(user)
  return Math.max(1, Math.min(wanted, plan.maxSwarmAgents))
}
