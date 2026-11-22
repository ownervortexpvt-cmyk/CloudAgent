import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/crypto'
import { syncVault } from '@/lib/provider-vault'

/**
 * POST /api/providers/bulk-import
 * Body: { providers: Array<{name, kind, apiKey, model, endpoint?, tag?, category?}> }
 *       OR a JSON string in the same format (for paste-import).
 *
 * Imports multiple providers in one shot. Used for the "520-key import"
 * scenario where the user has a JSON file with hundreds of provider keys.
 *
 * Returns: { ok, imported, skipped, errors[] }
 */
export async function POST(req: NextRequest) {
  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  let providers: any[]
  if (Array.isArray(body)) {
    providers = body
  } else if (Array.isArray(body.providers)) {
    providers = body.providers
  } else if (typeof body === 'string') {
    try { providers = JSON.parse(body) } catch { return NextResponse.json({ ok: false, error: 'Body is a string but not valid JSON' }, { status: 400 }) }
  } else {
    return NextResponse.json({ ok: false, error: 'Expected { providers: [...] } or array' }, { status: 400 })
  }

  if (!Array.isArray(providers) || providers.length === 0) {
    return NextResponse.json({ ok: false, error: 'No providers in payload' }, { status: 400 })
  }

  if (providers.length > 100000) {
    return NextResponse.json({ ok: false, error: `Too many providers (${providers.length}). Max 100000 per import.` }, { status: 400 })
  }

  const results = { ok: true, imported: 0, skipped: 0, duplicates: 0, errors: [] as string[] }

  // ─── Duplicate-key guard ───────────────────────────────────────────────
  // The same key must never enter the pool twice. Load every existing key,
  // plus track keys already seen inside this payload.
  const existingKeys = new Set<string>()
  try {
    const rows = await db.aIProvider.findMany({ select: { apiKeyEnc: true } })
    for (const r of rows) {
      if (!r.apiKeyEnc) continue
      try { existingKeys.add(decrypt(r.apiKeyEnc)) } catch {}
    }
  } catch {}
  const seenInPayload = new Set<string>()

  const validKinds = new Set([
    'zai', 'openai', 'openai-compatible', 'claude', 'gemini', 'groq', 'openrouter',
    'mistral', 'deepseek', 'together', 'together-free', 'fireworks', 'fireworks-free',
    'perplexity', 'cohere', 'ai21', 'novita', 'nebius', 'cerebras', 'sambanova',
    'xai', 'huggingface', 'replicate', 'anyscale', 'lepton', 'siliconflow',
    'openrouter-free', 'openrouter-uncensored', 'together-uncensored', 'huggingface-uncensored',
    'ollama-local', 'lmstudio-local', 'vllm-local', 'textgen-local', 'koboldcpp-local',
    'jan-local', 'faraday-local', 'runpod-uncensored', 'modal-uncensored',
    'replicate-uncensored', 'glhf-uncensored', 'featherless-uncensored',
    'helicone-uncensored', 'openai-pipe-uncensored', 'litellm-local', 'petals-uncensored',
    'cloudflare-ai-uncensored', 'custom',
  ])

  // Set isDefault=false for all existing providers if any of the new ones has isDefault=true
  const hasDefault = providers.some(p => p.isDefault)
  if (hasDefault) {
    try {
      await db.aIProvider.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
    } catch {}
  }

  for (let i = 0; i < providers.length; i++) {
    const p = providers[i]
    try {
      if (!p || typeof p !== 'object') { results.skipped++; continue }
      const { name, kind, apiKey, model, endpoint, tag, category, isDefault, systemPrompt, temperature, maxTokens } = p
      if (!name) { results.errors.push(`#${i + 1}: missing name`); results.skipped++; continue }
      if (!kind) { results.errors.push(`#${i + 1} (${name}): missing kind`); results.skipped++; continue }
      if (!validKinds.has(kind)) {
        results.errors.push(`#${i + 1} (${name}): unknown kind "${kind}"`)
        results.skipped++
        continue
      }
      if (kind !== 'zai' && !apiKey) { results.errors.push(`#${i + 1} (${name}): missing apiKey (required for ${kind})`); results.skipped++; continue }
      if (kind !== 'zai' && !model) { results.errors.push(`#${i + 1} (${name}): missing model`); results.skipped++; continue }

      // Skip keys that already exist in the pool or repeat inside this payload
      const keyStr = apiKey ? String(apiKey) : ''
      if (keyStr) {
        if (existingKeys.has(keyStr) || seenInPayload.has(keyStr)) {
          results.duplicates++
          results.skipped++
          if (results.errors.length < 20) results.errors.push(`#${i + 1} (${name}): duplicate API key — skipped (same key still works once)`)
          continue
        }
        seenInPayload.add(keyStr)
      }

      const data: any = {
        name: String(name).slice(0, 100),
        kind,
        endpoint: endpoint || null,
        model: model || 'glm-4.6',
        apiKeyEnc: apiKey ? encrypt(String(apiKey)) : null,
        tag: tag || null,
        category: category || null,
        isDefault: !!isDefault,
        systemPrompt: systemPrompt || null,
        temperature: typeof temperature === 'number' ? temperature : 0.7,
        maxTokens: maxTokens || null,
      }
      await db.aIProvider.create({ data })
      results.imported++
    } catch (e: any) {
      results.errors.push(`#${i + 1}: ${e.message || 'unknown error'}`)
      results.skipped++
    }
  }

  if (results.imported > 0) await syncVault()
  return NextResponse.json(results)
}
