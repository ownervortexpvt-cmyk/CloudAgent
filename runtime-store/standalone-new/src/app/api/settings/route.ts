import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { encrypt, decrypt, maskKey } from '@/lib/crypto'
import { requireProjectAccess, requireUser, UNAUTH_RESPONSE } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId')
  // BUSINESS v2: verify the caller owns this project (admins exempt).
  if (projectId) {
    try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  }
  if (projectId) {
    const vars = await db.envVar.findMany({ where: { projectId } })
    return NextResponse.json({
      envVars: vars.map(v => ({ ...v, value: v.isSecret ? maskKey(decrypt(v.value)) : decrypt(v.value), raw: undefined })),
    })
  }
  return NextResponse.json({ error: 'projectId required' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { projectId, key, value, isSecret } = body || {}
  if (!projectId || !key) return NextResponse.json({ error: 'projectId and key required' }, { status: 400 })
  // BUSINESS v2 (hardened): cross-tenant env-var writes are forbidden.
  try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  const enc = isSecret ? encrypt(value || '') : (value || '')
  const created = await db.envVar.upsert({
    where: { projectId_key: { projectId, key } },
    create: { projectId, key, value: enc, isSecret: !!isSecret },
    update: { value: enc, isSecret: !!isSecret },
  })
  return NextResponse.json({ envVar: { ...created, value: maskKey(value || '') } })
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')!
  // BUSINESS v2 (hardened): verify the caller owns the env-var's project
  // before removing it (admins exempt).
  const row = await db.envVar.findUnique({ where: { id }, select: { projectId: true } }).catch(() => null)
  if (row) {
    try { await requireProjectAccess(req, row.projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  }
  // Idempotent — P2025 (row already gone) used to surface as a 500
  await db.envVar.delete({ where: { id } }).catch(() => {})
  return NextResponse.json({ ok: true })
}
