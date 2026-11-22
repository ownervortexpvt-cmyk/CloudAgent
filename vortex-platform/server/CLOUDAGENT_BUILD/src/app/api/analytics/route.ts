/**
 * GET /api/analytics?projectId=&days=14 — dashboard aggregate:
 * totals, per-day series, top pages, referrers.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireProjectAccess } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId') || ''
  const days = Math.min(90, Math.max(1, parseInt(req.nextUrl.searchParams.get('days') || '14', 10) || 14))
  if (!projectId) return NextResponse.json({ ok: false, error: 'projectId required' }, { status: 400 })
  // BUSINESS v2: verify the caller owns this project (admins exempt).
  if (projectId) {
    try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const hits = await db.analyticsHit.findMany({
    where: { projectId, createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
  })

  const byDay = new Map<string, number>()
  const pages = new Map<string, number>()
  const refs = new Map<string, number>()
  for (const h of hits) {
    byDay.set(h.day, (byDay.get(h.day) || 0) + 1)
    pages.set(h.path, (pages.get(h.path) || 0) + 1)
    const r = h.referrer ? safeHost(h.referrer) : 'direct'
    refs.set(r, (refs.get(r) || 0) + 1)
  }

  // Fill the full day range so charts have no holes.
  const series: Array<{ day: string; views: number }> = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    series.push({ day: d, views: byDay.get(d) || 0 })
  }

  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ name: k, views: v }))

  return NextResponse.json({
    ok: true,
    totalViews: hits.length,
    days,
    series,
    topPages: top(pages, 8),
    referrers: top(refs, 8),
  })
}

function safeHost(url: string): string {
  try {
    return new URL(url).host || url.slice(0, 60)
  } catch {
    return url.slice(0, 60) || 'unknown'
  }
}
