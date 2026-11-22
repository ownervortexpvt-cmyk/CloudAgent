/**
 * v123 — /api/custom-domains/verify — DNS ownership check.
 * POST { id } → checks TXT _ca-verify.<domain> against the stored token via
 * public resolvers. Success → verified=true → the middleware starts serving
 * the project on that host (after the 30s site-map cache rolls over).
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { verifyDns } from '@/lib/custom-domains'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const user = await requireUser(req)
  const body = await req.json().catch(() => ({}))
  const id = String((body as any).id || '')
  const row = await db.customDomain.findUnique({ where: { id } })
  if (!row) return NextResponse.json({ ok: false, error: 'domain claim not found' }, { status: 404 })
  if (row.userId !== user.id && user.role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'not your domain' }, { status: 403 })
  }
  if (row.verified) {
    return NextResponse.json({ ok: true, verified: true, detail: 'already verified' })
  }
  const result = await verifyDns(row.domain, row.verifyToken)
  await db.customDomain.update({
    where: { id: row.id },
    data: {
      verified: result.ok,
      status: result.ok ? 'verified' : 'pending',
      verifiedAt: result.ok ? new Date() : null,
      lastCheckedAt: new Date(),
    },
  }).catch(() => {})
  return NextResponse.json({ ok: result.ok, verified: result.ok, detail: result.detail })
}
