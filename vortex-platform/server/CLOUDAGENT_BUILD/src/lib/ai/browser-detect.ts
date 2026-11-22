'use client'

/**
 * BROWSER-DIRECT key detection — the old Quick API Setup's superpower.
 *
 * Some providers (Groq, OpenAI, …) block the SERVER's datacenter IP with
 * Cloudflare (HTTP 403 for every request, valid key or not). The user's
 * device — phone or laptop — is NOT blocked. So we detect & verify the key
 * by calling the provider directly FROM THE BROWSER (like the old UI did:
 * "Live models fetched via YOUR device — provider blocks the server region").
 *
 * Flow: prefix → ordered candidates (shared with the server pipeline) →
 * probe every candidate's /models endpoint in parallel from the device →
 * the provider that answers 200 + models wins. No chat call needed: a 200
 * model list already proves the key is accepted.
 */

import { candidatesFor, friendlyHttpError, NON_CHAT_MODEL_RE, sortModelsDefaultFirst, type ProviderDef } from './key-detect'

export interface BrowserModel {
  id: string
  name?: string
  owned_by?: string
  context_length?: number
}

export interface BrowserDetectResult {
  ok: boolean
  /** Where the successful probe ran */
  via?: 'device'
  durationMs?: number
  providerKind?: string
  providerName?: string
  endpoint?: string
  models?: BrowserModel[]
  model?: string
  /** The provider answered with an HTTP error (key genuinely rejected / blocked) */
  status?: number
  error?: string
  /** fetch itself threw — CORS or network; the server fallback may still work */
  corsBlocked?: boolean
  tried?: Array<{ provider: string; status: string; error: string }>
}

/** Build fetch headers for one provider's models endpoint (browser context). */
function modelsRequest(def: ProviderDef, apiKey: string): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {}
  let url = def.modelsUrl
  if (def.auth === 'bearer') headers['Authorization'] = `Bearer ${apiKey}`
  else if (def.auth === 'x-api-key') {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
    // Anthropic requires this opt-in header for direct browser access
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
  } else if (def.auth === 'query') {
    url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=200`
  }
  return { url, headers }
}

/** Probe ONE provider's /models list from the browser. Never throws. */
async function browserProbe(def: ProviderDef, apiKey: string): Promise<
  | { outcome: 'ok'; models: BrowserModel[] }
  | { outcome: 'http'; status: number; error: string }
  | { outcome: 'network'; error: string }
> {
  try {
    const { url, headers } = modelsRequest(def, apiKey)
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(12000) })
    if (!res.ok) {
      if (res.status === 401) return { outcome: 'http', status: 401, error: friendlyHttpError(def.name, 401) }
      if (res.status === 403) return { outcome: 'http', status: 403, error: friendlyHttpError(def.name, 403) }
      if (res.status === 402) return { outcome: 'http', status: 402, error: friendlyHttpError(def.name, 402) }
      // 404 (or other) with known fallback models — e.g. Perplexity has NO
      // /models endpoint — chat-verify the fallbacks and win with one of them.
      if (def.probeModels?.length) {
        for (const m of def.probeModels) {
          const v = await deviceChatVerify(def, apiKey, m)
          if (v.ok) return { outcome: 'ok', models: [{ id: m, name: m, owned_by: def.name }] }
          if (v.status === 402) return { outcome: 'http', status: 402, error: friendlyHttpError(def.name, 402) }
        }
        return { outcome: 'http', status: res.status, error: friendlyHttpError(def.name, res.status) }
      }
      return { outcome: 'http', status: res.status, error: friendlyHttpError(def.name, res.status) }
    }
    const data: any = await res.json().catch(() => null)
    if (!data) return { outcome: 'http', status: res.status, error: `${def.name} returned invalid JSON` }

    let models: any[] = []
    if (Array.isArray(data)) models = data
    else if (Array.isArray(data.models)) models = data.models
    else if (Array.isArray(data.data)) models = data.data
    else if (Array.isArray(data.results)) models = data.results
    else if (data?.models?.models) models = data.models.models

    const filtered: BrowserModel[] = models
      .filter((m: any) => {
        const id = (m.id || m.name || '').toLowerCase()
        if (NON_CHAT_MODEL_RE.test(id)) return false
        if (m.deprecated) return false
        // v72 FIX — Google ListModels also returns models that CANNOT run a
        // chat turn (staged/rollout, tts-only, vision-only…) whose names slip
        // past NON_CHAT_MODEL_RE — generateContent on them 404s "Model not
        // found" and the auto-selected default dies on the very first Test.
        // The server routes have filtered by supportedGenerationMethods since
        // v68 (models route, fix-model, GeminiProvider.listChatModels) — the
        // device path MUST apply the same rule.
        if (Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.length > 0 && !m.supportedGenerationMethods.includes('generateContent')) return false
        return true
      })
      .map((m: any) => ({
        id: (m.id || m.name || '').replace(/^models\//, ''),
        name: m.display_name || m.friendly_name || m.id || m.name,
        owned_by: m.owned_by || m.organization || def.name,
        context_length: m.context_length || m.context_window || m.max_input_tokens,
      }))
      .filter((m: any) => !!m.id)
      .slice(0, 200)

    if (filtered.length === 0) return { outcome: 'http', status: 200, error: `${def.name} returned no chat models` }
    // Sort FIRST so the verify queue below walks the best candidates
    const ranked = sortModelsDefaultFirst(filtered)
    // v72 FIX — Gemini-class providers (query auth): a 200 model list proves
    // the KEY, not that the top-listed model can actually GENERATE (Google
    // lists staged/rollout models whose generateContent 404s — observed live:
    // gemini-3.8-flash listed, callable → HTTP 404). Verify the best model
    // with one tiny device chat call; on 404/402 fall through to the next
    // best, and float the VERIFIED model to the front so the auto-selected
    // default is proven callable — the same rule the server pipeline applies.
    if (def.auth === 'query') {
      const queue = ranked.slice(0, 3).map(m => m.id)
      let verifiedIdx = -1
      for (let i = 0; i < queue.length; i++) {
        const v = await deviceChatVerify(def, apiKey, queue[i])
        if (v.ok) { verifiedIdx = i; break }
        // only a bad MODEL (404) or paid-model-on-free-key (402) is worth
        // retrying with the next candidate — auth/network verdicts are final
        if (v.status !== 404 && v.status !== 402) break
      }
      if (verifiedIdx > 0) {
        const verified = ranked.splice(verifiedIdx, 1)[0]
        ranked.unshift(verified)
      }
      // verifiedIdx === -1 → network hiccup or all three rejected: keep the
      // ranked list as-is — the Test button still tells the truth.
    }
    // Public-/models provider (e.g. DeepInfra): the 200 model list proves
    // NOTHING about the key — confirm with a tiny chat call from the device
    // before this provider may win, otherwise every junk key would "detect"
    // as DeepInfra.
    if (def.publicModels) {
      // Verify the best model — but a 404 (model renamed/gated) or a 402
      // (paid model on a free-only key) is NOT the key's fault: try the next
      // best models before declaring failure, so free-only keys still pass
      // and the saved default model actually works.
      const verifyQueue = filtered.slice(0, 3).map(m => m.id)
      let lastStatus: number | undefined
      let verified = false
      for (const m of verifyQueue) {
        const v = await deviceChatVerify(def, apiKey, m)
        if (v.ok) { verified = true; break }
        lastStatus = v.status
        if (v.status !== 404 && v.status !== 402) break // auth/other → final
      }
      if (!verified) {
        if (lastStatus === 402) return { outcome: 'http', status: 402, error: friendlyHttpError(def.name, 402) }
        if (lastStatus === 401 || lastStatus === 403) return { outcome: 'http', status: lastStatus, error: `Key rejected by ${def.name} chat API (HTTP ${lastStatus})` }
        // network hiccup during verify — accept the model list (save flow re-verifies)
      }
    }
    // BEST models float to the TOP — the list leads with the ideal default
    // (query-auth providers: the VERIFIED model leads, see above)
    return { outcome: 'ok', models: ranked }
  } catch (e: any) {
    // TypeError from fetch = CORS or network block — the provider never answered
    return { outcome: 'network', error: e?.name === 'TimeoutError' ? `${def.name} timed out` : `${def.name} unreachable from this device (CORS or network)` }
  }
}

/** Tiny device-side chat call used to VERIFY a key/model pair. Never throws. */
async function deviceChatVerify(def: ProviderDef, apiKey: string, model: string): Promise<{ ok: boolean; status?: number }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    let url = def.chatUrl
    if (def.auth === 'bearer') headers['Authorization'] = `Bearer ${apiKey}`
    else if (def.auth === 'x-api-key') {
      headers['x-api-key'] = apiKey
      headers['anthropic-version'] = '2023-06-01'
      headers['anthropic-dangerous-direct-browser-access'] = 'true'
    } else if (def.auth === 'query') {
      url = `${def.chatUrl}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
    }
    const body = def.auth === 'query'
      ? { contents: [{ parts: [{ text: 'hi' }] }] }
      : { model, max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) })
    if (res.ok) return { ok: true }
    return { ok: false, status: res.status }
  } catch {
    return { ok: false } // network — treated as inconclusive
  }
}

function endpointOf(def: ProviderDef): string {
  return def.chatUrl
    ? def.chatUrl.replace(/\/chat\/completions$/, '').replace(/\/messages$/, '').replace(/\/text\/chatcompletion_v2$/, '')
    : def.modelsUrl.replace(/\/models$/, '')
}

/** Endpoint base per well-known provider kind — used to prefill the Endpoint
 *  field when the user picks a specific provider in Quick API Setup. */
export const KIND_ENDPOINTS: Record<string, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  claude: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
}

/**
 * Detect a key's provider by probing FROM THE USER'S DEVICE.
 * Prefix-matched candidates go first; an unrecognized format probes all 30+.
 * `forceKind` pins the chosen provider KIND to the front (used when the user
 * picks a specific provider instead of Auto); `forceName` pins an exact
 * provider NAME (needed for the several openai-compatible providers that
 * share one kind — Moonshot, Qwen, GLM, MiniMax…).
 */
export async function browserDetectKey(apiKey: string, endpoint?: string | null, forceKind?: string | null, forceName?: string | null): Promise<BrowserDetectResult> {
  const started = Date.now()
  const all = candidatesFor(apiKey, endpoint)
  // When the user explicitly picked a provider, try it FIRST
  let candidates = all
  if (forceKind || forceName) {
    const forced = all.filter(d => (forceKind && d.kind === forceKind) || (forceName && d.name === forceName))
    const rest = all.filter(d => !forced.includes(d))
    candidates = [...forced, ...rest]
    if (forced.length === 0 && endpoint && /^https?:\/\//.test(endpoint)) {
      // Unknown kind — probe the given endpoint directly. publicModels:true
      // forces a REAL chat verify (public model lists alone prove nothing —
      // e.g. DeepInfra / OpenRouter / AI Gateway / PPIO), so junk or
      // out-of-credit keys can never "connect".
      const base = endpoint.replace(/\/+$/, '')
      candidates = [{
        kind: forceKind || 'openai-compatible',
        name: forceName || (forceKind === 'openai-compatible' ? 'Custom endpoint' : (forceKind || 'Custom endpoint')),
        modelsUrl: `${base}/models`,
        chatUrl: `${base}/chat/completions`,
        auth: 'bearer',
        keyPrefixes: [],
        publicModels: true,
      }, ...rest]
    }
  }
  const results = await Promise.all(candidates.map(def => browserProbe(def, apiKey)))

  const winnerIdx = results.findIndex(r => r.outcome === 'ok')
  const winner = results[winnerIdx]
  if (winner && winner.outcome === 'ok') {
    const def = candidates[winnerIdx]
    return {
      ok: true,
      via: 'device',
      durationMs: Date.now() - started,
      providerKind: def.kind,
      providerName: def.name.replace(/\s*\(legacy sk-\)\s*$/, ''),
      endpoint: endpointOf(def),
      models: winner.models,
      model: winner.models[0]?.id,
    }
  }

  // Nothing accepted the key. Distinguish "provider answered: rejected/blocked"
  // from "fetch never got an answer (CORS/network)".
  const httpFails = results
    .map((r, i) => ({ r, def: candidates[i] }))
    .filter(x => x.r.outcome === 'http') as Array<{ r: { outcome: 'http'; status: number; error: string }; def: ProviderDef }>
  const networkFails = results.filter((r): r is { outcome: 'network'; error: string } => r.outcome === 'network')

  const tried = results.map((r, i) => ({
    provider: candidates[i].name,
    status: r.outcome === 'http' ? String(r.status) : r.outcome === 'network' ? 'network' : 'unknown',
    error: r.outcome === 'ok' ? 'accepted' : (r.error || 'unknown'),
  }))

  if (httpFails.length > 0) {
    // The device DID reach at least one provider and got a hard no.
    const top = httpFails[0]
    return {
      ok: false,
      status: top.r.status,
      durationMs: Date.now() - started,
      error: top.r.status === 403
        ? `${top.def.name} refused this request even from YOUR device (HTTP 403) — the key is invalid, expired, revoked, or out of credit.`
        : top.r.status === 401
          ? `${top.def.name} rejected this key from YOUR device too (HTTP 401) — the key is invalid, expired, or revoked. Double-check it on the provider dashboard.`
          : top.r.error,
      tried: tried.slice(0, 12),
    }
  }

  // Pure CORS/network failure — let the server pipeline try
  return {
    ok: false,
    corsBlocked: true,
    durationMs: Date.now() - started,
    error: networkFails[0]?.error || 'No provider could be reached from this device',
    tried: tried.slice(0, 12),
  }
}

export interface BrowserTestResult {
  ok: boolean
  durationMs: number
  reply?: string
  error?: string
}

/** Tiny chat call FROM THE USER'S DEVICE — the Test button of Quick API Setup.
 *  Proves the key + endpoint + model combo actually completes a generation. */
export async function browserTestChat(opts: {
  kind: string
  endpoint: string
  apiKey: string
  model: string
}): Promise<BrowserTestResult> {
  const started = Date.now()
  const kind = opts.kind || 'openai-compatible'
  const base = (opts.endpoint || KIND_ENDPOINTS[kind] || 'https://api.openai.com/v1').replace(/\/$/, '')
  try {
    let res: Response
    if (kind === 'claude') {
      res = await fetch(`${base}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': opts.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model: opts.model, max_tokens: 16, messages: [{ role: 'user', content: 'Say OK' }] }),
        signal: AbortSignal.timeout(30000),
      })
    } else if (kind === 'gemini') {
      res = await fetch(`${base}/models/${encodeURIComponent(opts.model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Say OK' }] }] }),
        signal: AbortSignal.timeout(30000),
      })
    } else {
      res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${opts.apiKey}` },
        body: JSON.stringify({ model: opts.model, max_tokens: 16, messages: [{ role: 'user', content: 'Say OK' }] }),
        signal: AbortSignal.timeout(30000),
      })
    }
    const text = await res.text()
    if (!res.ok) {
      let msg = text.slice(0, 300)
      try { msg = JSON.parse(text)?.error?.message || msg } catch {}
      return { ok: false, durationMs: Date.now() - started, error: `HTTP ${res.status}: ${msg}` }
    }
    const data = JSON.parse(text)
    let reply = ''
    if (kind === 'claude') reply = (data.content || []).map((c: any) => c.text || '').join(' ')
    else if (kind === 'gemini') reply = (data.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join(' ')
    else reply = data.choices?.[0]?.message?.content || ''
    return { ok: true, durationMs: Date.now() - started, reply: (reply || 'OK').slice(0, 120) }
  } catch (e: any) {
    return { ok: false, durationMs: Date.now() - started, error: e?.message || 'Network error from this device' }
  }
}
