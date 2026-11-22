import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { syncVault } from '@/lib/provider-vault'

/**
 * POST /api/providers/update-model  { id, model }
 *
 * Partial update used by the Quick API Setup model list ("click a model to
 * use it"). The full POST /api/providers route overwrites every field and
 * requires name+kind — too heavy and risky for a one-click model switch.
 */
export async function POST(req: NextRequest) {
  const { id, model } = await req.json().catch(() => ({}))
  if (!id || !model || typeof model !== 'string') {
    return NextResponse.json({ ok: false, error: 'id and model required' }, { status: 400 })
  }
  try {
    const row = await db.aIProvider.update({ where: { id }, data: { model } })
    await syncVault()
    return NextResponse.json({ ok: true, provider: { id: row.id, name: row.name, model: row.model } })
  } catch (e: any) {
    // P2025 = record not found — an unknown provider id is a 404, not a 500
    if (e?.code === 'P2025') {
      return NextResponse.json({ ok: false, error: 'Provider not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: false, error: e?.message || 'update failed' }, { status: 500 })
  }
}
