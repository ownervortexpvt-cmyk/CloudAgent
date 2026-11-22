import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { buildProvider } from '@/lib/ai/providers'
import { isUnlockedRequest } from '@/lib/lock'

/**
 * Server-side provider "Test" (restored — v25.2/v25.3 contract, v28 re-add).
 *
 * POST { id }                      → tests the SAVED provider (key decrypted
 *                                    server-side, never returned)
 * POST { kind, endpoint?, apiKey, model, temperature? } → tests raw values
 *
 * Runs ONE minimal REAL chat completion ("Say OK", maxTokens 16, 30s timeout)
 * through the SAME buildProvider factory the swarm uses — so the verdict is
 * the truth, not a ping. Upstream HTTP status is preserved as {status};
 * transport failures are normalised to "could not reach …"; custom kind
 * without endpoint and missing model are clean 400s.
 */
export async function POST(req: NextRequest) {
  if (!(await isUnlockedRequest(req))) {
    return NextResponse.json({ error: 'locked' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'body required' }, { status: 400 })
  }

  let kind = typeof body.kind === 'string' ? body.kind : ''
  let endpoint = typeof body.endpoint === 'string' ? body.endpoint : undefined
  let apiKey = typeof body.apiKey === 'string' ? body.apiKey : ''
  let model = typeof body.model === 'string' ? body.model : ''
  let temperature = typeof body.temperature === 'number' ? body.temperature : undefined

  // Saved-provider flow: id only — pull the row and decrypt the key server-side.
  if (typeof body.id === 'string' && body.id) {
    const row = await db.aIProvider.findUnique({ where: { id: body.id } }).catch(() => null)
    if (!row) return NextResponse.json({ error: 'provider not found' }, { status: 404 })
    kind = row.kind
    endpoint = row.endpoint || undefined
    apiKey = row.apiKeyEnc ? decrypt(row.apiKeyEnc) : ''
    model = row.model || ''
    temperature = typeof row.temperature === 'number' ? row.temperature : undefined
  }

  if (!kind) kind = 'custom'

  // Validation (clean 400s, same contract as v25.2)
  if (kind === 'custom' && !endpoint) {
    return NextResponse.json({ ok: false, error: 'Custom provider needs an endpoint URL (e.g. https://host/v1)' }, { status: 400 })
  }
  if (!model) {
    return NextResponse.json({ ok: false, error: 'Model is required to test this provider' }, { status: 400 })
  }
  if (kind !== 'zai' && !apiKey) {
    return NextResponse.json({ ok: false, error: 'API key is required for this provider kind' }, { status: 400 })
  }

  const provider = buildProvider({
    kind,
    name: typeof body.name === 'string' && body.name ? body.name : kind,
    endpoint,
    apiKey,
    model,
    temperature,
  })

  const started = Date.now()
  try {
    const res = await provider.chat(
      [{ role: 'user', content: 'Say OK' }],
      { maxTokens: 16, temperature: temperature ?? 0, signal: AbortSignal.timeout(30_000) } as any,
    )
    const reply = String(res?.content || '').trim()
    return NextResponse.json({
      ok: reply.length > 0,
      reply,
      model: provider.model,
      durationMs: Date.now() - started,
    })
  } catch (e: any) {
    const raw = String(e?.message || e || 'unknown error')
    const durationMs = Date.now() - started
    const statusMatch = raw.match(/HTTP (\d{3})/)
    const status = statusMatch ? Number(statusMatch[1]) : undefined

    // AbortSignal.timeout → classify as unreachable transport, not upstream error
    if (/timeouterror|timed out|aborted/i.test(raw) || e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      return NextResponse.json({
        ok: false,
        error: `could not reach the provider — the request timed out after 30s`,
        durationMs,
      })
    }

    // Network-level failures (ECONNREFUSED, ENOTFOUND, fetch failed …)
    if (!status && /fetch failed|network|econn|enotfound|eai_again|socket/i.test(raw)) {
      return NextResponse.json({
        ok: false,
        error: `could not reach the provider — ${raw.split('\n')[0].slice(0, 160)}`,
        durationMs,
      })
    }

    return NextResponse.json({
      ok: false,
      error: raw.split('\n').slice(0, 2).join(' ').slice(0, 300),
      ...(status ? { status } : {}),
      durationMs,
    })
  }
}
