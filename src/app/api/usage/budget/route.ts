/**
 * /api/usage/budget — v60 Monthly AI budget cap.
 *  GET  → { ok, enabled, budgetUSD, spentUSD, monthStart }
 *  POST { value: '5.50' | '0' | '' }  '' clears the cap
 * Stored in UserSetting('budget_monthly_usd'). The enforcement itself lives
 * in lib/budget.ts and runs at both run entry points.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { checkBudget, BUDGET_KEY } from '@/lib/budget'

export async function GET() {
  const v = await checkBudget()
  return NextResponse.json({
    ok: true,
    enabled: v.enabled,
    budgetUSD: v.enabled ? v.budgetUSD : null,
    spentUSD: v.spentUSD,
    monthStart: v.monthStart,
  })
}

export async function POST(req: NextRequest) {
  // SECURITY FIX: the budget cap is PLATFORM-GLOBAL (enforced for every run
  // on the whole builder). Any signed-in user used to be able to set or
  // CLEAR it (clearing = removing the owner's spend cap). Admin-only now.
  try { await requireAdmin(req) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  const body = await req.json().catch(() => ({} as any))
  const raw = body?.value === undefined || body?.value === null ? '' : String(body.value).trim()
  if (raw !== '') {
    const n = parseFloat(raw)
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000) {
      return NextResponse.json({ ok: false, error: 'value must be a number ≥ 0 (or "" to clear the cap)' }, { status: 400 })
    }
  }
  await db.userSetting.upsert({
    where: { key: BUDGET_KEY },
    create: { key: BUDGET_KEY, value: raw },
    update: { value: raw },
  })
  const v = await checkBudget()
  return NextResponse.json({ ok: true, enabled: v.enabled, budgetUSD: v.enabled ? v.budgetUSD : null, spentUSD: v.spentUSD })
}
