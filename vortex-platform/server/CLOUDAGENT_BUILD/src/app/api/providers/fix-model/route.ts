import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { syncVault } from '@/lib/provider-vault'
import { isUnlockedRequest } from '@/lib/lock'
import { ZAI_MODEL_IDS } from '@/lib/zai-models'

/**
 * v68 POST /api/providers/fix-model  { id }
 *
 * STALE-MODEL AUTO-FIX — Google retired the whole Gemini 1.5 family and the
 * "-001" suffixes, so saved providers started answering HTTP 404 "Models not
 * found. Check the model name." on every call. This endpoint asks the
 * provider's live model list and, when the saved model is gone:
 *   1. picks the best still-live replacement (preferred order for Gemini,
 *      family-token fuzzy match for the rest),
 *   2. PERSISTS it on the provider row (the run loop heals itself from here on),
 *   3. returns { fixed: true, from, to } so the UI can tell the truth.
 * A provider whose saved model is still live returns { fixed: false, model } —
 * nothing is touched. Key never leaves the server.
 */
const GEMINI_FALLBACKS = [
  'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite',
  'gemini-flash-latest', 'gemini-flash-lite-latest',
  'gemini-2.0-flash', 'gemini-2.0-flash-lite',
]

/** Family tokens worth preserving when fuzzy-matching (llama-3.3 stays llama-3.3 …). */
function familyTokens(model: string): string[] {
  return String(model).toLowerCase().split(/[^a-z0-9.]+/).filter((t) => t.length >= 3)
}

async function listLiveModels(kind: string, apiKey: string, endpoint?: string): Promise<string[]> {
  try {
    if (kind === 'zai') {
      return [...ZAI_MODEL_IDS] // curated lineup from the shared source — GLM has no public /models
    }
    if (kind === 'gemini') {
      const base = (endpoint || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '')
      const res = await fetch(`${base}/models?pageSize=1000&key=${encodeURIComponent(apiKey)}`, {
        headers: { 'x-goog-api-key': apiKey },
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) return []
      const data: any = await res.json()
      const rows: any[] = Array.isArray(data?.models) ? data.models : []
      return rows
        .filter((m) => !m.deprecated && (!Array.isArray(m.supportedGenerationMethods) || m.supportedGenerationMethods.includes('generateContent')))
        .map((m) => String(m.name || '').replace(/^models\//, '').trim())
        .filter(Boolean)
    }
    // Everything else speaks OpenAI-compatible GET /models (claude: anthropic shape)
    const url = kind === 'claude'
      ? 'https://api.anthropic.com/v1/models'
      : `${(endpoint || '').replace(/\/$/, '')}/models`
    if (!url || url === '/models') return []
    const headers: Record<string, string> = kind === 'claude'
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${apiKey}` }
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return []
    const data: any = await res.json()
    const rows: any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : []
    return rows
      .filter((m) => !m.deprecated && m.status !== 'deprecated')
      .map((m) => String(m.id || m.name || '').trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function pickBest(saved: string, live: string[]): string | null {
  if (!live.length) return null
  if (live.includes(saved)) return saved
  // 1) shared family tokens, most-specific overlap first
  const savedTokens = new Set(familyTokens(saved))
  let best: { id: string; score: number } | null = null
  for (const id of live) {
    const overlap = familyTokens(id).filter((t) => savedTokens.has(t)).length
    if (overlap > 0 && (!best || overlap > best.score)) best = { id, score: overlap }
  }
  if (best) return best.id
  // 2) provider-preferred defaults (Gemini order above; a sane first model otherwise)
  const gem = GEMINI_FALLBACKS.find((m) => live.includes(m))
  if (gem) return gem
  return live[0]
}

export async function POST(req: NextRequest) {
  if (!(await isUnlockedRequest(req))) {
    return NextResponse.json({ error: 'locked' }, { status: 401 })
  }
  const { id } = await req.json().catch(() => ({}))
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
  }
  try {
    const row = await db.aIProvider.findUnique({ where: { id } })
    if (!row) return NextResponse.json({ ok: false, error: 'Provider not found' }, { status: 404 })
    const apiKey = row.apiKeyEnc ? decrypt(row.apiKeyEnc) : ''
    const saved = String(row.model || '').trim()
    const live = await listLiveModels(row.kind, apiKey, row.endpoint || undefined)
    if (!live.length) {
      return NextResponse.json({ ok: false, error: 'Could not fetch the live model list from this provider (bad key, no network, or unsupported kind) — nothing was changed.' })
    }
    const best = pickBest(saved, live)
    if (!best) {
      return NextResponse.json({ ok: false, error: 'Live list came back empty after filtering — nothing was changed.' })
    }
    if (best === saved) {
      return NextResponse.json({ ok: true, fixed: false, model: saved, liveCount: live.length, message: `"${saved}" is still live (${live.length} models available) — nothing to fix.` })
    }
    await db.aIProvider.update({ where: { id }, data: { model: best } })
    await syncVault().catch(() => {})
    return NextResponse.json({
      ok: true,
      fixed: true,
      from: saved,
      to: best,
      liveCount: live.length,
      message: `Fixed: "${saved}" is retired → switched to "${best}" (still live, ${live.length} models available).`,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'fix-model failed' }, { status: 500 })
  }
}
