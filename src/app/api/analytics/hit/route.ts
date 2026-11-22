/**
 * POST /api/analytics/hit — beacon receiver for published sites.
 * Accepts JSON or sendBeacon Blob body. Public by design (anonymous
 * page-view telemetry), rate-light, no cookies, no PII.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const ct = req.headers.get('content-type') || ''
    let body: any = {}
    if (ct.includes('json')) body = await req.json()
    else {
      const text = await req.text()
      try { body = JSON.parse(text) } catch { /* malformed beacon — ignore */ }
    }
    const projectId = String(body.p || body.projectId || '')
    if (!projectId) return NextResponse.json({ ok: false }, { status: 400 })

    await db.analyticsHit.create({
      data: {
        projectId,
        path: String(body.path || '/').slice(0, 300),
        referrer: String(body.r || body.referrer || '').slice(0, 300),
        ua: (req.headers.get('user-agent') || '').slice(0, 200),
        day: new Date().toISOString().slice(0, 10),
      },
    })
    return NextResponse.json({ ok: true })
  } catch {
    // Never break the visitor's page because of analytics.
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
