import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { buildProvider } from '@/lib/ai/providers'
import { isUnlockedRequest } from '@/lib/lock'

/**
 * v56 — 🩺 TEST ALL KEYS (bulk health check of the whole saved pool).
 *
 * POST /api/providers/test-all  { }  (no body needed)
 *
 * Loads EVERY saved AIProvider row, decrypts each key server-side (keys are
 * never returned to the client) and fires ONE minimal REAL chat completion
 * per provider ("Say OK", maxTokens 16, 30s timeout each) — all IN PARALLEL
 * via Promise.allSettled, so a 32-key pool is verdict-ed in ~30s worst case,
 * not minutes. The verdict logic mirrors /api/providers/test exactly (same
 * buildProvider factory the swarm uses — the verdict is the truth, not a
 * ping; upstream HTTP status preserved; transport failures normalised).
 *
 * Response: { okCount, total, durationMs, results: [{ id, name, kind, model,
 *   ok, reply?, error?, status?, durationMs }] }
 */
export async function POST(req: NextRequest) {
  if (!(await isUnlockedRequest(req))) {
    return NextResponse.json({ error: 'locked' }, { status: 401 })
  }

  const startedAll = Date.now()
  const rows = await db.aIProvider.findMany({ orderBy: { createdAt: 'asc' } })

  if (rows.length === 0) {
    return NextResponse.json({
      okCount: 0,
      total: 0,
      durationMs: 0,
      results: [],
      note: 'No saved keys to test — add a provider first (Quick API Setup or Add Provider).',
    })
  }

  async function testOne(row: (typeof rows)[number]) {
    const started = Date.now()
    const kind = row.kind || 'custom'
    const endpoint = row.endpoint || undefined
    const apiKey = row.apiKeyEnc ? decrypt(row.apiKeyEnc) : ''
    const model = row.model || ''

    if (!model) {
      return { id: row.id, name: row.name, kind, model, ok: false, error: 'No model configured for this provider', durationMs: 0 }
    }
    if (kind !== 'zai' && !apiKey) {
      return { id: row.id, name: row.name, kind, model, ok: false, error: 'No API key stored for this provider (built-in Vortex Engine needs none)', durationMs: 0 }
    }

    try {
      const provider = buildProvider({
        kind,
        name: row.name,
        endpoint,
        apiKey,
        model,
        temperature: typeof row.temperature === 'number' ? row.temperature : undefined,
      })
      const res = await provider.chat(
        [{ role: 'user', content: 'Say OK' }],
        { maxTokens: 16, temperature: 0, signal: AbortSignal.timeout(30_000) } as any,
      )
      const reply = String(res?.content || '').trim()
      return {
        id: row.id,
        name: row.name,
        kind,
        model,
        ok: reply.length > 0,
        ...(reply ? { reply: reply.slice(0, 40) } : { error: 'Provider replied with an empty message' }),
        durationMs: Date.now() - started,
      }
    } catch (e: any) {
      const raw = String(e?.message || e || 'unknown error')
      const durationMs = Date.now() - started
      const statusMatch = raw.match(/HTTP (\d{3})/)
      const status = statusMatch ? Number(statusMatch[1]) : undefined

      // AbortSignal.timeout → classify as unreachable transport, not upstream error
      if (/timeouterror|timed out|aborted/i.test(raw) || e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        return { id: row.id, name: row.name, kind, model, ok: false, error: 'could not reach the provider — the request timed out after 30s', durationMs }
      }
      // Network-level failures (ECONNREFUSED, ENOTFOUND, fetch failed …)
      if (!status && /fetch failed|network|econn|enotfound|eai_again|socket/i.test(raw)) {
        return { id: row.id, name: row.name, kind, model, ok: false, error: `could not reach the provider — ${raw.split('\n')[0].slice(0, 160)}`, durationMs }
      }
      return {
        id: row.id,
        name: row.name,
        kind,
        model,
        ok: false,
        error: raw.split('\n').slice(0, 2).join(' ').slice(0, 300),
        ...(status ? { status } : {}),
        durationMs,
      }
    }
  }

  const settled = await Promise.allSettled(rows.map(r => testOne(r)))
  const results = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { id: rows[i].id, name: rows[i].name, kind: rows[i].kind || 'custom', model: rows[i].model || '', ok: false, error: 'Health check crashed for this provider', durationMs: 0 },
  )
  const okCount = results.filter(r => r.ok).length

  return NextResponse.json({
    okCount,
    total: results.length,
    durationMs: Date.now() - startedAll,
    results,
  })
}
