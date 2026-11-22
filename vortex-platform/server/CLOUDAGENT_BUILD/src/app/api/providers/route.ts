import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { encrypt, decrypt, maskKey } from '@/lib/crypto'
import { syncVault, restoreIfEmpty } from '@/lib/provider-vault'

export async function GET() {
  // v53 Provider Vault — if a platform reset wiped the DB, silently re-seed
  // the user's keys from the disk vault before answering.
  const restored = await restoreIfEmpty()
  const providers = await db.aIProvider.findMany({
    orderBy: { createdAt: 'asc' },
  })
  // Never expose raw API keys to the client — only a masked preview.
  return NextResponse.json({
    providers: providers.map(p => ({
      ...p,
      apiKeyMasked: p.apiKeyEnc ? maskKey(decryptSafe(p.apiKeyEnc)) : null,
      apiKeyEnc: undefined,
    })),
    vaultRestored: restored > 0 ? restored : undefined,
  })
}

function decryptSafe(_enc: string) {
  // We can't decrypt on the client; return a placeholder marker so the mask
  // function can produce a sensible string without leaking the real key.
  return 'xxxxxxxxxxxxxxxx'
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { id, name, kind, endpoint, apiKey, model, systemPrompt, temperature, maxTokens, isDefault } = body || {}
  // Allow empty apiKey for built-in providers like the Vortex Engine
  if (!name || !kind) return NextResponse.json({ error: 'name and kind required' }, { status: 400 })
  if (!model && kind !== 'zai') return NextResponse.json({ error: 'model required' }, { status: 400 })

  // ─── Duplicate-key guard ───────────────────────────────────────────────
  // The SAME key must never be added twice (it would still do the work of one
  // key — duplicates only pollute the pool). Adding the SAME provider with a
  // DIFFERENT key is always allowed. When editing, keeping your own key is OK.
  if (apiKey && typeof apiKey === 'string' && apiKey.length >= 10) {
    const existing = await db.aIProvider.findMany({
      select: { id: true, name: true, apiKeyEnc: true },
      ...(id ? { where: { NOT: { id } } } : {}),
    })
    for (const row of existing) {
      if (!row.apiKeyEnc) continue
      try {
        if (decrypt(row.apiKeyEnc) === apiKey) {
          return NextResponse.json(
            {
              error: `This API key is already added as "${row.name}". The same key cannot be added twice — add a DIFFERENT key instead.`,
              duplicateOf: row.name,
            },
            { status: 409 },
          )
        }
      } catch {}
    }
  }

  try {
    const data: any = {
      name,
      kind,
      endpoint: endpoint || null,
      model: model || 'glm-4.6',
      systemPrompt: systemPrompt || null,
      temperature: typeof temperature === 'number' ? temperature : 0.7,
      maxTokens: maxTokens || null,
      isDefault: !!isDefault,
    }
    if (apiKey) {
      data.apiKeyEnc = encrypt(apiKey)
    }
    if (id) {
      const updated = await db.aIProvider.update({ where: { id }, data })
      if (isDefault) {
        await db.aIProvider.updateMany({ where: { id: { not: id } }, data: { isDefault: false } })
      }
      await syncVault()
      return NextResponse.json({ provider: updated })
    }
    const created = await db.aIProvider.create({ data })
    if (isDefault) {
      await db.aIProvider.updateMany({ where: { id: { not: created.id } }, data: { isDefault: false } })
    }
    await syncVault()
    return NextResponse.json({ provider: created })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to save provider' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')!
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  // Idempotent delete — a bare delete threw Prisma P2025 (500) when the row
  // was already gone (e.g. double-click)
  await db.aIProvider.delete({ where: { id } }).catch(() => {})
  await syncVault()
  return NextResponse.json({ ok: true })
}
