import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { buildProvider } from '@/lib/ai/providers'
import { ZAI_MODELS } from '@/lib/zai-models'

/**
 * POST /api/providers/models
 * Body: { id?: string, kind?: string, apiKey?: string, endpoint?: string }
 *
 * Fetches the list of available models from a provider's API.
 * Works for OpenAI-compatible providers (most of them) which expose
 * GET /v1/models. Also works for Anthropic, Gemini, and others.
 *
 * Returns: { ok, models: [{id, name?, owned_by?}], source }
 */
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { id, kind, apiKey, endpoint } = body || {}

  let providerKind: string = kind || 'zai'
  let providerApiKey: string = apiKey || ''
  let providerEndpoint: string | undefined = endpoint
  let providerName: string = providerKind

  // If id provided, load from DB
  if (id) {
    try {
      const row = await db.aIProvider.findUnique({ where: { id } })
      if (!row) return NextResponse.json({ ok: false, error: 'Provider not found' }, { status: 404 })
      providerKind = row.kind
      providerApiKey = row.apiKeyEnc ? decrypt(row.apiKeyEnc) : ''
      providerEndpoint = row.endpoint || undefined
      providerName = row.name
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: `DB error: ${e.message}` }, { status: 500 })
    }
  }

  // Determine the /models endpoint for known providers
  const modelsEndpoints: Record<string, string> = {
    openai: 'https://api.openai.com/v1/models',
    groq: 'https://api.groq.com/openai/v1/models',
    openrouter: 'https://openrouter.ai/api/v1/models',
    mistral: 'https://api.mistral.ai/v1/models',
    deepseek: 'https://api.deepseek.com/models',
    together: 'https://api.together.xyz/v1/models',
    fireworks: 'https://api.fireworks.ai/inference/v1/models',
    perplexity: 'https://api.perplexity.ai/models',
    cohere: 'https://api.cohere.com/v1/models',
    'cerebras': 'https://api.cerebras.ai/v1/models',
    'sambanova': 'https://api.sambanova.ai/v1/models',
    'xai': 'https://api.x.ai/v1/models',
    'huggingface': 'https://api-inference.huggingface.co/v1/models',
    'siliconflow': 'https://api.siliconflow.cn/v1/models',
  }

  let url: string | undefined = providerEndpoint ? `${providerEndpoint.replace(/\/$/, '')}/models` : modelsEndpoints[providerKind]
  // For Anthropic, the models endpoint is different
  if (providerKind === 'claude') url = 'https://api.anthropic.com/v1/models'
  // For Gemini (v68: a custom endpoint — self-hosted proxy / test double —
  // is now respected; only the default falls back to Google)
  if (providerKind === 'gemini') {
    url = `${(providerEndpoint || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '')}/models?pageSize=1000&key=${encodeURIComponent(providerApiKey)}`
  }
  // GLM (no public /models endpoint — return the shared curated lineup;
  // v70/v71: one source of truth in src/lib/zai-models.ts, big models included)
  if (providerKind === 'zai' || !url) {
    return NextResponse.json({
      ok: true,
      source: 'curated',
      models: ZAI_MODELS.map((m) => ({ id: m.id, name: m.name, owned_by: 'z.ai' })),
    })
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (providerApiKey) headers['Authorization'] = `Bearer ${providerApiKey}`
    if (providerKind === 'claude') {
      headers['x-api-key'] = providerApiKey
      headers['anthropic-version'] = '2023-06-01'
    }
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })
    if (!res.ok) {
      const txt = await res.text()
      return NextResponse.json({ ok: false, error: `HTTP ${res.status}: ${txt.slice(0, 200)}` })
    }
    const data: any = await res.json()
    // Normalize response shape
    let models: any[] = []
    if (Array.isArray(data)) models = data
    else if (Array.isArray(data.models)) models = data.models
    else if (Array.isArray(data.data)) models = data.data
    else if (Array.isArray(data?.models?.models)) models = data.models.models

    // Filter to LLM chat models only (skip embedding, image, tts, etc.)
    const filtered = models
      .filter((m: any) => {
        const id = (m.id || m.name || '').toLowerCase()
        // Skip embeddings, audio, image, whisper
        if (/embed|whisper|tts|audio|image|moderation|dall-|davinci|babbage|ada|curie/.test(id)) return false
        // Skip deprecated
        if (m.deprecated || m.status === 'deprecated') return false
        return true
      })
      .map((m: any) => ({
        id: m.id || m.name,
        name: m.display_name || m.friendly_name || m.id || m.name,
        owned_by: m.owned_by || m.ownedBy || m.organization || m.creator || providerName,
        context_length: m.context_length || m.context_window || m.max_input_tokens,
        description: m.description || m.summary || '',
      }))
      .slice(0, 100) // Cap at 100 models

    // v68 Gemini: keep only chat-capable models, strip the "models/" prefix,
    // and float the currently-live families to the top (ListModels returns
    // embedding/tts/vision models too — none of them can run the agent).
    let finalModels: any[] = filtered
    if (providerKind === 'gemini') {
      const PREF = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.0-flash', 'gemini-2.0-flash-lite']
      finalModels = models
        .filter((m: any) => !m.deprecated && (!Array.isArray(m.supportedGenerationMethods) || m.supportedGenerationMethods.includes('generateContent')))
        .map((m: any) => ({
          id: String(m.name || m.id || '').replace(/^models\//, '').trim(),
          name: m.displayName || m.description?.slice(0, 80) || String(m.name || '').replace(/^models\//, ''),
          owned_by: 'google',
        }))
        .filter((m: any) => m.id)
      finalModels.sort((a: any, b: any) => {
        const ia = PREF.indexOf(a.id), ib = PREF.indexOf(b.id)
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
      })
    }

    return NextResponse.json({
      ok: true,
      source: 'live',
      models: finalModels,
      total: finalModels.length,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to fetch models' })
  }
}
