import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { requireProjectAccess } from '@/lib/auth'

/**
 * POST /api/settings/reveal { id } → { ok, value }
 * Returns the REAL (decrypted) value of ONE project-scoped secret to its
 * owner. Global secrets are never revealable by design. The caller must own
 * the project the secret belongs to (admins exempt) — the row's OWN project
 * is what gets checked, no matter what else the caller sends.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const id = typeof (body as any)?.id === 'string' ? (body as any).id : ''
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })

  const row = await db.envVar.findUnique({ where: { id } }).catch(() => null)
  if (!row) return NextResponse.json({ ok: false, error: 'secret not found' }, { status: 404 })

  try { await requireProjectAccess(req, row.projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }

  const value = row.isSecret ? decrypt(row.value) : row.value
  return NextResponse.json({ ok: true, value, key: row.key })
}
