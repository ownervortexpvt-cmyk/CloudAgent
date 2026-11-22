/**
 * v60 — Monthly AI budget guard.
 *
 * The owner can cap how much the army is ALLOWED to spend per calendar month
 * (rough list-price estimate over recorded usage — the same honest math as
 * the Usage tab). Stored in UserSetting('budget_monthly_usd'):
 *   '' (absent/empty) → no cap — every run passes
 *   '0'               → block everything (free-pool cold stop)
 *   '5' / '5.50'      → block when THIS month's recorded spend ≥ the cap
 *
 * The guard runs at the two run entry points (/api/agent, /api/multi-agent)
 * BEFORE any model call, so an exceeded budget costs zero tokens.
 * Scheduled runs and webhook-driven flows go through the same APIs, so they
 * are guarded identically.
 */
import { db } from '@/lib/db'
import { estimateCostUSD } from '@/lib/pricing'

export const BUDGET_KEY = 'budget_monthly_usd'

export interface BudgetVerdict {
  enabled: boolean
  budgetUSD: number
  spentUSD: number
  blocked: boolean
  monthStart: string // YYYY-MM-01
}

export async function checkBudget(): Promise<BudgetVerdict> {
  const monthStart = new Date().toISOString().slice(0, 7) + '-01'
  const raw = (await db.userSetting.findUnique({ where: { key: BUDGET_KEY } }).catch(() => null))?.value
  const budgetUSD = raw === null || raw === undefined || String(raw).trim() === ''
    ? NaN
    : Math.max(0, parseFloat(String(raw)))
  if (!Number.isFinite(budgetUSD)) {
    return { enabled: false, budgetUSD: 0, spentUSD: 0, blocked: false, monthStart }
  }

  // Recorded usage since the 1st of this month (UTC), per provider.
  const rows = await db.usageDaily.findMany({
    where: { day: { gte: monthStart } },
    select: { provider: true, tokensIn: true, tokensOut: true },
  }).catch(() => [])

  let spentUSD = 0
  for (const r of rows) spentUSD += estimateCostUSD(r.provider, r.tokensIn, r.tokensOut)
  spentUSD = Math.round(spentUSD * 10_000) / 10_000

  return { enabled: true, budgetUSD, spentUSD, blocked: spentUSD >= budgetUSD, monthStart }
}

/** Honest, user-facing block message (English — UI copy). */
export function budgetBlockMessage(v: BudgetVerdict): string {
  return `Monthly AI budget reached — $${v.spentUSD.toFixed(2)} spent of the $${v.budgetUSD.toFixed(2)} cap. ` +
    'No tokens were used for this request. Raise or clear the cap in Settings → Usage → Monthly budget.'
}
