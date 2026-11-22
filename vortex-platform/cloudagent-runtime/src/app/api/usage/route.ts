/**
 * /api/usage — AI usage dashboard data (v25, cost-estimates v55).
 *
 * GET ?days=14 → per-day series + per-provider totals + grand totals + rough $ estimates
 * POST { action:'reset' } → wipe the usage history
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { estimateCostUSD, PRICING_NOTE } from '@/lib/pricing'

export async function GET(req: NextRequest) {
  const days = Math.min(90, Math.max(1, parseInt(new URL(req.url).searchParams.get('days') || '14', 10) || 14))
  const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10)

  const rows = await db.usageDaily.findMany({
    where: { day: { gte: since } },
    orderBy: { day: 'asc' },
    take: 5000,
  })

  // per-day series
  const byDay = new Map<string, { requests: number; tokensIn: number; tokensOut: number; errors: number }>()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)
    byDay.set(d, { requests: 0, tokensIn: 0, tokensOut: 0, errors: 0 })
  }
  // per-provider totals
  const byProvider = new Map<string, { provider: string; requests: number; tokensIn: number; tokensOut: number; errors: number }>()

  for (const r of rows) {
    const d = byDay.get(r.day)
    if (d) {
      d.requests += r.requests
      d.tokensIn += r.tokensIn
      d.tokensOut += r.tokensOut
      d.errors += r.errorCount
    }
    const key = r.provider
    const p = byProvider.get(key) || { provider: key, requests: 0, tokensIn: 0, tokensOut: 0, errors: 0 }
    p.requests += r.requests
    p.tokensIn += r.tokensIn
    p.tokensOut += r.tokensOut
    p.errors += r.errorCount
    byProvider.set(key, p)
  }

  const series = [...byDay.entries()].map(([day, v]) => ({ day, ...v }))
  // v55: honest rough $ estimate per provider + total (label it in the UI!)
  const withCost = <T extends { provider: string; tokensIn: number; tokensOut: number }>(p: T) => ({
    ...p,
    costUSD: Math.round(estimateCostUSD(p.provider, p.tokensIn, p.tokensOut) * 10_000) / 10_000,
  })
  const providers = [...byProvider.values()].sort((a, b) => b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut)).map(withCost)
  const totals = providers.reduce(
    (acc, p) => ({
      requests: acc.requests + p.requests,
      tokensIn: acc.tokensIn + p.tokensIn,
      tokensOut: acc.tokensOut + p.tokensOut,
      errors: acc.errors + p.errors,
    }),
    { requests: 0, tokensIn: 0, tokensOut: 0, errors: 0 },
  )
  const totalCostUSD = Math.round(providers.reduce((acc, p) => acc + (p.costUSD || 0), 0) * 10_000) / 10_000

  return NextResponse.json({ ok: true, days, series, providers, totals, totalCostUSD, pricingNote: PRICING_NOTE })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, string>))
  if (String(body.action) !== 'reset') {
    return NextResponse.json({ ok: false, error: 'action must be reset' }, { status: 400 })
  }
  const del = await db.usageDaily.deleteMany({})
  return NextResponse.json({ ok: true, deleted: del.count })
}
