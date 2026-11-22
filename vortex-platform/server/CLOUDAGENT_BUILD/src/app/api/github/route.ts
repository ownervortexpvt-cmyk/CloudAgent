import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { encrypt, decrypt, maskKey } from '@/lib/crypto'
import { requireUser } from '@/lib/auth'

/**
 * GitHub account management — token-based only, v123 PER-USER.
 *   GET    → MY accounts (token masked). Admins see all rows.
 *   POST   → save MY account (token encrypted at rest, stamped with my userId)
 *   DELETE → remove my account (or admin any)
 *
 * v123 change: rows are scoped by userId — builder A never sees builder B's
 * PAT. Legacy rows (userId null) stay visible to admins only.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser(req)
  const rows = user.role === 'admin'
    ? await db.gitHubAccount.findMany({ orderBy: { createdAt: 'desc' } })
    : await db.gitHubAccount.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } })
  return NextResponse.json({
    accounts: rows.map((a) => ({
      ...a,
      tokenEnc: undefined,
      tokenMasked: maskKey(decrypt(a.tokenEnc)),
    })),
  })
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req)
  const body = await req.json()
  const { name, token, username, defaultOwner } = body || {}
  if (!name || !token) return NextResponse.json({ error: 'name and token required' }, { status: 400 })
  const created = await db.gitHubAccount.create({
    data: { name, tokenEnc: encrypt(token), username, defaultOwner, userId: user.id },
  })
  return NextResponse.json({ account: { ...created, tokenMasked: maskKey(token), tokenEnc: undefined } })
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser(req)
  const id = req.nextUrl.searchParams.get('id')!
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const row = await db.gitHubAccount.findUnique({ where: { id } }).catch(() => null)
  if (row && row.userId && row.userId !== user.id && user.role !== 'admin') {
    return NextResponse.json({ error: 'not your GitHub account' }, { status: 403 })
  }
  // Idempotent — P2025 (row already gone) used to surface as a 500
  await db.gitHubAccount.delete({ where: { id } }).catch(() => {})
  return NextResponse.json({ ok: true })
}
