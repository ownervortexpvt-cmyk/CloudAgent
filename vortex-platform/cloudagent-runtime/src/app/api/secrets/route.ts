import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { encrypt, decrypt, maskKey } from '@/lib/crypto'

/**
 * Global secrets — stored as UserSetting rows with key prefix `secret:`.
 * Encrypted at rest. Returned masked to the client.
 *
 *   GET    → list all secrets (masked values)
 *   POST   → upsert a secret
 *   DELETE → remove a secret
 */
export async function GET() {
  const rows = await db.userSetting.findMany({ where: { key: { startsWith: 'secret:' } } })
  const secrets = rows.map(r => {
    const key = r.key.replace(/^secret:/, '')
    const isSecret = !r.key.endsWith(':plain')
    return {
      id: r.id,
      key,
      value: isSecret ? maskKey(decrypt(r.value)) : decrypt(r.value),
      masked: isSecret ? maskKey(decrypt(r.value)) : decrypt(r.value),
      isSecret,
      scope: 'global' as const,
    }
  })
  return NextResponse.json({ secrets })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { id, key, value, isSecret } = body
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })
  const fullKey = isSecret ? `secret:${key}` : `secret:${key}:plain`
  const stored = isSecret ? encrypt(value || '') : (value || '')
  try {
    const upserted = await db.userSetting.upsert({
      where: { key: fullKey },
      create: { key: fullKey, value: stored },
      update: { value: stored },
    })
    return NextResponse.json({ ok: true, id: upserted.id, key, masked: maskKey(value || '') })
  } catch (e: any) {
    return NextResponse.json({ error: e.message, stack: e.stack }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')!
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const row = await db.userSetting.findUnique({ where: { id } })
  if (row) {
    await db.userSetting.delete({ where: { id } })
  }
  return NextResponse.json({ ok: true })
}
