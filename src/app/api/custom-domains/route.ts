/**
 * v123 — /api/custom-domains — users run their apps on their own domains.
 *
 *   GET            → my domains (each with DNS instructions)
 *   POST           → claim a domain for one of my projects
 *                    { domain, projectId } → creates a pending claim + token
 *   DELETE ?id=    → remove my claim
 *
 * Ownership rules: the project must be MINE (or admin). Domain is normalized
 * to lowercase, validated, unique across the platform. Verification happens
 * in /api/custom-domains/verify (DNS TXT check) — until then the domain is
 * NOT served.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireProjectAccess, requireUser } from '@/lib/auth'
import { DOMAIN_RE, newVerifyToken } from '@/lib/custom-domains'

export const runtime = 'nodejs'

function instructions(domain: string, token: string) {
  return [
    {
      type: 'TXT',
      name: `_ca-verify.${domain}`,
      value: token,
      purpose: 'Proves you own this domain (required before the site goes live).',
    },
    {
      type: 'A',
      name: domain,
      value: 'THIS_SERVER_IP',
      purpose: 'Points the domain at this CloudAgent server (ask the operator for the IP, or use a CNAME to the platform host if DNS allows it on the apex).',
    },
  ]
}

export async function GET(req: NextRequest) {
  const user = await requireUser(req)
  const where = user.role === 'admin' ? {} : { userId: user.id }
  const rows = await db.customDomain.findMany({ where, orderBy: { createdAt: 'desc' } })
  const mine = await Promise.all(rows.map(async (r) => {
    const project = await db.project.findUnique({ where: { id: r.projectId }, select: { name: true, status: true, entryPort: true } }).catch(() => null)
    return {
      id: r.id,
      domain: r.domain,
      projectId: r.projectId,
      projectName: project?.name || '(deleted project)',
      siteStatus: project ? project.status : 'gone',
      verified: r.verified,
      status: r.status,
      verifyToken: r.verifyToken,
      createdAt: r.createdAt,
      dns: instructions(r.domain, r.verifyToken),
    }
  }))
  return NextResponse.json({ ok: true, domains: mine })
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req)
  const body = await req.json().catch(() => null)
  const domain = String((body as any)?.domain || '').toLowerCase().trim().replace(/\.$/, '')
  const projectId = String((body as any)?.projectId || '')
  if (!DOMAIN_RE.test(domain) || domain.length > 253) {
    return NextResponse.json({ ok: false, error: 'Enter a valid domain like shop.mybrand.in' }, { status: 400 })
  }
  if (!projectId) return NextResponse.json({ ok: false, error: 'projectId required' }, { status: 400 })
  try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }

  const existing = await db.customDomain.findUnique({ where: { domain } })
  if (existing && existing.projectId === projectId && existing.userId === user.id) {
    return NextResponse.json({ ok: true, domain: existing, resumed: true })
  }
  if (existing) {
    return NextResponse.json({ ok: false, error: 'This domain is already claimed on CloudAgent.' }, { status: 409 })
  }

  // sane per-user cap (abuse guard, not a business rule)
  const count = await db.customDomain.count({ where: { userId: user.id } })
  if (count >= 10) {
    return NextResponse.json({ ok: false, error: 'Domain limit reached (10). Remove one to add another.' }, { status: 429 })
  }

  const created = await db.customDomain.create({
    data: { userId: user.id, projectId, domain, verifyToken: newVerifyToken(), status: 'pending' },
  })
  return NextResponse.json({ ok: true, domain: created, dns: instructions(created.domain, created.verifyToken) })
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser(req)
  const id = req.nextUrl.searchParams.get('id') || ''
  const row = await db.customDomain.findUnique({ where: { id } })
  if (!row) return NextResponse.json({ ok: true })
  if (row.userId !== user.id && user.role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'not your domain' }, { status: 403 })
  }
  await db.customDomain.delete({ where: { id } }).catch(() => {})
  return NextResponse.json({ ok: true })
}
