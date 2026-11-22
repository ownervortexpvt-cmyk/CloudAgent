/**
 * Shared API-key → provider detection library.
 *
 * Used by:
 *   - POST /api/providers/auto-detect  (single key → provider + all models)
 *   - POST /api/providers/quick-setup  (one or MANY keys → detect + save all)
 *
 * Strategy:
 *   1. Key PREFIX narrows the candidate list (most specific first)
 *   2. ALL candidates' /models endpoints are probed IN PARALLEL (fast)
 *   3. The winner is VERIFIED with a tiny chat call; if it rejects the key,
 *      the next candidate that accepted the key is tried automatically
 *   4. Returns provider name + kind + endpoint + ALL available models
 */

export interface ProviderDef {
  kind: string
  name: string
  modelsUrl: string
  chatUrl: string
  auth: 'bearer' | 'x-api-key' | 'query'
  keyPrefixes: string[]  // patterns to match the key against ("" = no distinct prefix)
  // /models is PUBLIC (no auth needed) — a 200 model list does NOT prove the
  // key works, so the detection must confirm with a tiny chat call
  // (e.g. DeepInfra, OpenRouter) before declaring a win.
  publicModels?: boolean
  // Some providers (e.g. Replicate) are not OpenAI-chat compatible — skip verify
  skipChatVerify?: boolean
  // Fallback chat models for providers with NO public /models endpoint
  // (e.g. Perplexity returns HTTP 404 on /models). When the models list
  // cannot be fetched, the detection chat-verifies these instead and the
  // first one that answers becomes the working default model.
  probeModels?: string[]
}

/** Human-friendly English explanation for a provider HTTP status. Used by
 *  BOTH the server pipeline and the browser-direct prober so the user never
 *  sees a bare "HTTP 402" / "HTTP 404" again. */
export function friendlyHttpError(defName: string, status: number): string {
  if (status === 401) return `${defName} rejected this key (HTTP 401 — invalid, expired or revoked). Double-check it on the provider dashboard.`
  if (status === 402) return `${defName} accepted the key but the account has NO CREDIT left (HTTP 402 — payment required). Top up on the provider dashboard, or add a FREE provider (Gemini, Groq, OpenRouter free models) instead.`
  if (status === 403) return `${defName} refused the request (HTTP 403). Often a server-region block — your device may still be accepted.`
  if (status === 404) return `${defName} does not expose that endpoint (HTTP 404). If the models list is unavailable, type the model id manually.`
  if (status === 429) return `${defName} rate-limited this key (HTTP 429). Wait a moment and try again.`
  return `${defName} returned HTTP ${status}`
}

export const PROVIDERS: ProviderDef[] = [
  // ───── Unique prefixes (highest confidence) ─────
  { kind: 'groq', name: 'Groq', modelsUrl: 'https://api.groq.com/openai/v1/models', chatUrl: 'https://api.groq.com/openai/v1/chat/completions', auth: 'bearer', keyPrefixes: ['gsk_'] },
  { kind: 'openrouter', name: 'OpenRouter', modelsUrl: 'https://openrouter.ai/api/v1/models', chatUrl: 'https://openrouter.ai/api/v1/chat/completions', auth: 'bearer', keyPrefixes: ['sk-or-'], publicModels: true },
  { kind: 'claude', name: 'Anthropic Claude', modelsUrl: 'https://api.anthropic.com/v1/models', chatUrl: 'https://api.anthropic.com/v1/messages', auth: 'x-api-key', keyPrefixes: ['sk-ant-'] },
  { kind: 'openai', name: 'OpenAI', modelsUrl: 'https://api.openai.com/v1/models', chatUrl: 'https://api.openai.com/v1/chat/completions', auth: 'bearer', keyPrefixes: ['sk-proj-', 'sk-svcacct-'] },
  { kind: 'gemini', name: 'Google Gemini', modelsUrl: '', chatUrl: 'https://generativelanguage.googleapis.com/v1beta/models', auth: 'query', keyPrefixes: ['AIza'] },
  { kind: 'xai', name: 'xAI (Grok)', modelsUrl: 'https://api.x.ai/v1/models', chatUrl: 'https://api.x.ai/v1/chat/completions', auth: 'bearer', keyPrefixes: ['xai-'] },
  // Perplexity has NO /models endpoint (HTTP 404) — detection falls back to
  // chat-verifying these known models and the winner becomes the default.
  { kind: 'perplexity', name: 'Perplexity', modelsUrl: 'https://api.perplexity.ai/models', chatUrl: 'https://api.perplexity.ai/chat/completions', auth: 'bearer', keyPrefixes: ['pplx-'], probeModels: ['sonar', 'sonar-pro', 'llama-3.1-sonar-small-128k-online'] },
  { kind: 'huggingface', name: 'Hugging Face', modelsUrl: 'https://api-inference.huggingface.co/v1/models', chatUrl: 'https://api-inference.huggingface.co/v1/chat/completions', auth: 'bearer', keyPrefixes: ['hf_'] },
  { kind: 'openai-compatible', name: 'ModelScope', modelsUrl: 'https://api-inference.modelscope.cn/v1/models', chatUrl: 'https://api-inference.modelscope.cn/v1/chat/completions', auth: 'bearer', keyPrefixes: ['ms-'] },
  { kind: 'openai-compatible', name: 'GitHub Models', modelsUrl: 'https://models.inference.ai.azure.com/models', chatUrl: 'https://models.inference.ai.azure.com/chat/completions', auth: 'bearer', keyPrefixes: ['ghp_', 'gho_', 'ghu_', 'github_pat_'] },
  { kind: 'openai-compatible', name: 'Gitee AI', modelsUrl: 'https://ai.gitee.com/v1/models', chatUrl: 'https://ai.gitee.com/v1/chat/completions', auth: 'bearer', keyPrefixes: [] },
  { kind: 'openai-compatible', name: 'MiniMax', modelsUrl: 'https://api.minimax.chat/v1/models', chatUrl: 'https://api.minimax.chat/v1/text/chatcompletion_v2', auth: 'bearer', keyPrefixes: ['eyJ'] },
  { kind: 'openai-compatible', name: 'Baidu Qianfan', modelsUrl: 'https://qianfan.baidubce.com/v2/models', chatUrl: 'https://qianfan.baidubce.com/v2/chat/completions', auth: 'bearer', keyPrefixes: ['bce-'] },
  { kind: 'openai-compatible', name: 'Volcengine Ark', modelsUrl: 'https://ark.cn-beijing.volces.com/api/v3/models', chatUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', auth: 'bearer', keyPrefixes: [] },
  // GLM (Zhipu) keys look like "id.secret" (contain a dot, no standard prefix)
  { kind: 'openai-compatible', name: 'GLM (Zhipu)', modelsUrl: 'https://api.z.ai/api/paas/v4/models', chatUrl: 'https://api.z.ai/api/paas/v4/chat/completions', auth: 'bearer', keyPrefixes: ['id.'] },
  { kind: 'openai-compatible', name: 'Zhipu BigModel', modelsUrl: 'https://open.bigmodel.cn/api/paas/v4/models', chatUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', auth: 'bearer', keyPrefixes: [] },

  // ───── sk- ambiguous family (tried in this order when key starts with sk-) ─────
  { kind: 'deepseek', name: 'DeepSeek', modelsUrl: 'https://api.deepseek.com/models', chatUrl: 'https://api.deepseek.com/chat/completions', auth: 'bearer', keyPrefixes: ['sk-'] },
  { kind: 'openai-compatible', name: 'Moonshot (Kimi)', modelsUrl: 'https://api.moonshot.cn/v1/models', chatUrl: 'https://api.moonshot.cn/v1/chat/completions', auth: 'bearer', keyPrefixes: ['sk-'] },
  { kind: 'openai-compatible', name: 'Qwen (DashScope)', modelsUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models', chatUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', auth: 'bearer', keyPrefixes: ['sk-'] },
  { kind: 'siliconflow', name: 'SiliconFlow', modelsUrl: 'https://api.siliconflow.cn/v1/models', chatUrl: 'https://api.siliconflow.cn/v1/chat/completions', auth: 'bearer', keyPrefixes: ['sk-'] },

  // ───── No distinct prefix — probed for any unrecognized key ─────
  // Venice.ai — uncensored models (venice-uncensored-*, dolphin…) — REAL: HTTP 200 with a valid key
  { kind: 'venice', name: 'Venice.ai (uncensored)', modelsUrl: 'https://api.venice.ai/api/v1/models', chatUrl: 'https://api.venice.ai/api/v1/chat/completions', auth: 'bearer', keyPrefixes: [] },
  // DeepInfra — hosts uncensored Euryale/Hermes/Dolphin models — /models is PUBLIC, so the winner is proven by the chat-verify step
  { kind: 'deepinfra', name: 'DeepInfra', modelsUrl: 'https://api.deepinfra.com/v1/openai/models', chatUrl: 'https://api.deepinfra.com/v1/openai/chat/completions', auth: 'bearer', keyPrefixes: [], publicModels: true },
  { kind: 'mistral', name: 'Mistral AI', modelsUrl: 'https://api.mistral.ai/v1/models', chatUrl: 'https://api.mistral.ai/v1/chat/completions', auth: 'bearer', keyPrefixes: [] },
  { kind: 'together', name: 'Together AI', modelsUrl: 'https://api.together.xyz/v1/models', chatUrl: 'https://api.together.xyz/v1/chat/completions', auth: 'bearer', keyPrefixes: [] },
  { kind: 'fireworks', name: 'Fireworks AI', modelsUrl: 'https://api.fireworks.ai/inference/v1/models', chatUrl: 'https://api.fireworks.ai/inference/v1/chat/completions', auth: 'bearer', keyPrefixes: [] },
  { kind: 'cerebras', name: 'Cerebras', modelsUrl: 'https://api.cerebras.ai/v1/models', chatUrl: 'https://api.cerebras.ai/v1/chat/completions', auth: 'bearer', keyPrefixes: [] },
  { kind: 'sambanova', name: 'SambaNova', modelsUrl: 'https://api.sambanova.ai/v1/models', chatUrl: 'https://api.sambanova.ai/v1/chat/completions', auth: 'bearer', keyPrefixes: [] },
  { kind: 'nebius', name: 'Nebius', modelsUrl: 'https://api.studio.nebius.ai/v1/models', chatUrl: 'https://api.studio.nebius.ai/v1/chat/completions', auth: 'bearer', keyPrefixes: [] },
  { kind: 'novita', name: 'Novita AI', modelsUrl: 'https://api.novita.ai/v3/openai/models', chatUrl: 'https://api.novita.ai/v3/openai/chat/completions', auth: 'bearer', keyPrefixes: [] },
  { kind: 'cohere', name: 'Cohere', modelsUrl: 'https://api.cohere.com/v1/models', chatUrl: 'https://api.cohere.com/v1/chat', auth: 'bearer', keyPrefixes: [] },
  { kind: 'ai21', name: 'AI21 Labs', modelsUrl: 'https://api.ai21.com/v1/models', chatUrl: 'https://api.ai21.com/v1/chat/completions', auth: 'bearer', keyPrefixes: [] },
  { kind: 'openai', name: 'OpenAI (legacy sk-)', modelsUrl: 'https://api.openai.com/v1/models', chatUrl: 'https://api.openai.com/v1/chat/completions', auth: 'bearer', keyPrefixes: ['sk-'] },
]




/**
 * Non-chat model families that must NEVER be the default pick (and sink to the
 * bottom of the list): video (veo), image (imagen), live/realtime streams,
 * robotics, translation, streaming-only previews, embeddings, audio…
 */
export const NON_CHAT_MODEL_RE = /embed|whisper|tts|audio|image|video|veo|imagen|moderation|dall-|babbage|ada|curie|transcribe|text-embedding|realtime|rerank|robotics|translat|live-|-live|streaming|aqa|computer-use|nano-banana|guard|shield/

/**
 * Score a model id for DEFAULT selection — higher = better default for agent
 * work. The BEST model floats to the top of the Quick Setup list and is
 * auto-selected after Get, so the user never lands on a veo/live/preview junk
 * model again.
 */
export function scoreModelDefault(id: string): number {
  const s = (id || '').toLowerCase()
  let score = 50
  // fast + cheap models are ideal for swarm agents
  if (/flash|mini|instant|haiku|small|turbo|lite|fast|-8b\b/.test(s)) score += 22
  if (/70b|72b|405b|\bpro\b|max|large|plus/.test(s)) score += 10
  if (/latest/.test(s)) score += 6
  if (/:free$|\bfree\b/.test(s)) score += 14
  if (/preview|exp\b|alpha|experimental/.test(s)) score -= 38
  const knownHits: Array<[RegExp, number]> = [
    [/^gemini-2\.\d-flash/, 45], [/gemini.*flash/, 40],
    [/^gemini-2\.\d-pro/, 30], [/gemini.*pro/, 22],
    [/^llama-3\.3-70b/, 42], [/^llama-3\.1-8b-instant/, 38], [/llama/, 18],
    [/^gpt-4o-mini/, 45], [/^gpt-4o/, 36], [/^gpt-4\.1/, 32], [/^o[34]-mini/, 25],
    [/claude-(sonnet|3\.5-sonnet|3-5-sonnet|3-7)/, 42], [/claude-(haiku|3-5-haiku|3\.5-haiku)/, 38], [/claude-opus/, 28],
    [/^deepseek-chat|^deepseek-v3|^deepseek-reasoner/, 44], [/deepseek-r\d/, 30],
    [/:free$/, 28], [/^meta-llama\/llama-3\.3-70b/, 40],
    [/^qwen.*\d+b/, 24], [/^grok/, 26], [/^command-r/, 24], [/^glm-4/, 30],
    [/^mistral-(large|small|codestral)/, 28], [/^kimi-|^moonshot/, 26],
  ]
  for (const [re, bonus] of knownHits) { if (re.test(s)) { score += bonus; break } }
  // junk that slipped through the filter sinks hard
  if (NON_CHAT_MODEL_RE.test(s)) score -= 100
  return score
}

/** Sort models BEST-DEFAULT-FIRST for the Quick Setup list + auto-select. */
export function sortModelsDefaultFirst<T extends { id: string }>(models: T[]): T[] {
  return [...models].sort((a, b) => scoreModelDefault(b.id) - scoreModelDefault(a.id))
}

export interface ProbeResult {
  def: ProviderDef
  ok: boolean
  models: any[]
  error?: string
}

export interface DetectionResult {
  ok: boolean
  error?: string
  detected?: {
    providerKind: string
    providerName: string
    endpoint: string
    models: Array<{ id: string; name?: string; owned_by?: string; context_length?: number }>
    verified: boolean
    verifyError: string
  }
  keyHint?: string
  alternates?: string[]
  tried?: Array<{ provider: string; status: string; error: string }>
  triedCount?: number
}

/** Probe the /models list of one provider. Never throws. */
export async function probeModels(def: ProviderDef, apiKey: string): Promise<ProbeResult> {
  let lastFallbackError = ''
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (def.auth === 'bearer') headers['Authorization'] = `Bearer ${apiKey}`
    else if (def.auth === 'x-api-key') {
      headers['x-api-key'] = apiKey
      headers['anthropic-version'] = '2023-06-01'
    }

    let modelsUrl = def.modelsUrl
    if (def.auth === 'query') {
      modelsUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=200`
    }

    const res = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(12000) })

    if (!res.ok) {
      if (res.status === 401) return { def, ok: false, models: [], error: friendlyHttpError(def.name, 401) }
      if (res.status === 403) return { def, ok: false, models: [], error: friendlyHttpError(def.name, 403) }
      // 402 = key VALID but out of credit — a hard, user-actionable verdict.
      if (res.status === 402) return { def, ok: false, models: [], error: friendlyHttpError(def.name, 402) }
      // 404 (or any other failure) with known fallback models — e.g. Perplexity
      // has no /models endpoint at all — chat-verify the probeModels instead.
      if (def.probeModels?.length) {
        for (const m of def.probeModels) {
          const v = await verifyChat(def, apiKey, m)
          if (v.ok) {
            return { def, ok: true, models: [{ id: m, name: m, owned_by: def.name }] }
          }
          lastFallbackError = v.error || ''
          if (v.status === 402) { lastFallbackError = friendlyHttpError(def.name, 402); break }
        }
        return { def, ok: false, models: [], error: lastFallbackError || friendlyHttpError(def.name, res.status) }
      }
      if (res.status === 404) return { def, ok: false, models: [], error: friendlyHttpError(def.name, 404) }
      return { def, ok: false, models: [], error: friendlyHttpError(def.name, res.status) }
    }

    const data: any = await res.json().catch(() => null)
    if (!data) return { def, ok: false, models: [], error: `${def.name} returned invalid JSON` }

    let models: any[] = []
    if (Array.isArray(data)) models = data
    else if (Array.isArray(data.models)) models = data.models
    else if (Array.isArray(data.data)) models = data.data
    else if (Array.isArray(data.results)) models = data.results
    else if (data?.models?.models) models = data.models.models
    else if (data?.success && Array.isArray(data.data)) models = data.data

    if (models.length === 0) return { def, ok: false, models: [], error: `${def.name} returned no models` }

    const filtered = models
      .filter((m: any) => {
        const id = (m.id || m.name || '').toLowerCase()
        if (NON_CHAT_MODEL_RE.test(id)) return false
        if (m.deprecated) return false
        // v72 FIX — same rule as the browser path and the models route:
        // a listed model without generateContent support (staged/rollout,
        // tts-only…) can never answer a chat call — never the default pick.
        if (Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.length > 0 && !m.supportedGenerationMethods.includes('generateContent')) return false
        return true
      })
      .map((m: any) => ({
        id: (m.id || m.name || '').replace(/^models\//, ''),
        name: m.display_name || m.friendly_name || m.id || m.name,
        owned_by: m.owned_by || m.organization || m.creator || m.publisher || def.name,
        context_length: m.context_length || m.context_window || m.max_input_tokens,
      }))
      .filter((m: any) => !!m.id)
      .slice(0, 200)

    if (filtered.length === 0) return { def, ok: false, models: [], error: `${def.name} has no chat models` }
    return { def, ok: true, models: filtered }
  } catch (e: any) {
    return { def, ok: false, models: [], error: e?.message === 'TimeoutError' ? `${def.name} timed out` : (e?.message || `${def.name} unreachable`) }
  }
}

/** Tiny chat completion to prove the key actually works. Never throws.
 *  `fallbacks` — when the primary model 404s (renamed/gated) or 402s (paid
 *  model on a free-only key), the next models are tried before giving up,
 *  so the user saves an agent that ACTUALLY works. */
export async function verifyChat(def: ProviderDef, apiKey: string, modelId: string, fallbacks: string[] = []): Promise<{ ok: boolean; status?: number; error?: string; model?: string }> {
  if (!modelId || !def.chatUrl) return { ok: true }
  const queue = [modelId, ...fallbacks.filter(m => m && m !== modelId)]
  let last: { ok: boolean; status?: number; error?: string } = { ok: false, status: undefined, error: 'no model to verify' }
  for (const model of queue) {
    last = await verifyChatOnce(def, apiKey, model)
    if (last.ok) return { ...last, model }
    // Only a bad/non-working MODEL (404) or a paid-model on a free key (402)
    // is worth retrying with the next candidate — auth errors are final.
    if (last.status !== 404 && last.status !== 402) return last
  }
  return last
}

async function verifyChatOnce(def: ProviderDef, apiKey: string, modelId: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    let res: Response
    if (def.auth === 'x-api-key') {
      res = await fetch(def.chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: modelId, max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }),
        signal: AbortSignal.timeout(15000),
      })
    } else if (def.auth === 'query') {
      res = await fetch(`${def.chatUrl}/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] }),
        signal: AbortSignal.timeout(15000),
      })
    } else if (def.kind === 'cohere') {
      res = await fetch(def.chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: modelId, message: 'hi' }),
        signal: AbortSignal.timeout(15000),
      })
    } else {
      res = await fetch(def.chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: modelId, max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }),
        signal: AbortSignal.timeout(15000),
      })
    }
    // 200 = works. 400/429 = key valid, model accepted — still "verified".
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, error: `Key rejected by ${def.name} chat API (HTTP ${res.status})` }
    }
    if (res.status === 402) {
      return { ok: false, status: 402, error: friendlyHttpError(def.name, 402) }
    }
    if (res.status === 404) {
      // Parse the body for a clearer "model not found" message when present
      let detail = ''
      try { detail = JSON.parse(await res.text())?.error?.message || '' } catch { /* keep empty */ }
      return { ok: false, status: 404, error: `${def.name} does not know the model "${modelId}" (HTTP 404${detail ? ` — ${detail}` : ''}). Pick another model.` }
    }
    return { ok: true, status: res.status }
  } catch (e: any) {
    // Network/timeout during verify — the models list was fine, accept it
    return { ok: true }
  }
}

export function endpointOf(def: ProviderDef): string {
  return def.chatUrl
    ? def.chatUrl.replace(/\/chat\/completions$/, '').replace(/\/messages$/, '').replace(/\/text\/chatcompletion_v2$/, '')
    : def.modelsUrl.replace(/\/models$/, '')
}

export function getKeyHint(apiKey: string): string {
  if (apiKey.startsWith('gsk_')) return 'This looks like a Groq key (gsk_...).'
  if (apiKey.startsWith('sk-or-')) return 'This looks like an OpenRouter key (sk-or-...).'
  if (apiKey.startsWith('sk-ant-')) return 'This looks like an Anthropic/Claude key (sk-ant-...).'
  if (apiKey.startsWith('sk-proj-')) return 'This looks like an OpenAI project key (sk-proj-...).'
  if (apiKey.startsWith('AIza')) return 'This looks like a Google/Gemini key (AIza...).'
  if (apiKey.startsWith('xai-')) return 'This looks like an xAI/Grok key (xai-...).'
  if (apiKey.startsWith('pplx-')) return 'This looks like a Perplexity key (pplx-...).'
  if (apiKey.startsWith('hf_')) return 'This looks like a Hugging Face token (hf_...).'
  if (apiKey.startsWith('ms-')) return 'This looks like a ModelScope token (ms-...).'
  if (apiKey.startsWith('github_pat_') || /^(ghp|gho|ghu)_/.test(apiKey)) return 'This looks like a GitHub token — GitHub Models.'
  if (apiKey.startsWith('r8_')) return 'This looks like a Replicate token (r8_...).'
  if (apiKey.startsWith('bce-')) return 'This looks like a Baidu Qianfan key (bce-...).'
  if (/^[a-z0-9]+\.[A-Za-z0-9]{20,}$/.test(apiKey)) return 'This looks like a GLM (Zhipu) key (id.secret format).'
  if (apiKey.startsWith('sk-')) return 'sk- keys are used by OpenAI, DeepSeek, Moonshot, Qwen and SiliconFlow — all of them were probed.'
  return 'Key format not recognized — all 30+ supported providers were probed in parallel.'
}

/**
 * Ordered candidate list for a key: custom endpoint first, then prefix-matched
 * providers (most specific prefix first), or ALL providers when the format is
 * unrecognized. Shared by the server pipeline AND the browser-direct prober.
 */
export function candidatesFor(apiKey: string, endpoint?: string | null): ProviderDef[] {
  const keyLower = apiKey.toLowerCase()
  const candidates: ProviderDef[] = []

  if (endpoint && /^https?:\/\//.test(endpoint)) {
    const base = endpoint.replace(/\/+$/, '')
    candidates.push({
      kind: 'openai-compatible',
      name: `Custom endpoint (${base})`,
      modelsUrl: `${base}/models`,
      chatUrl: `${base}/chat/completions`,
      auth: 'bearer',
      keyPrefixes: [],
      // Model lists on custom endpoints may be PUBLIC — always prove the key
      // with a tiny chat call before this candidate may win.
      publicModels: true,
    })
  }

  // Prefix matches — sort by prefix specificity (longer prefix = more specific)
  const prefixMatched = PROVIDERS
    .filter(p => p.keyPrefixes.some(pf => apiKey.startsWith(pf) || keyLower.startsWith(pf.toLowerCase())))
    .sort((a, b) => {
      const la = Math.max(...a.keyPrefixes.map(pf => apiKey.startsWith(pf) || keyLower.startsWith(pf.toLowerCase()) ? pf.length : 0))
      const lb = Math.max(...b.keyPrefixes.map(pf => apiKey.startsWith(pf) || keyLower.startsWith(pf.toLowerCase()) ? pf.length : 0))
      return lb - la
    })
  candidates.push(...prefixMatched)

  if (prefixMatched.length === 0) {
    // Unrecognized key format — probe EVERYTHING in parallel (still fast)
    candidates.push(...PROVIDERS.filter(p => !candidates.includes(p)))
  }
  return candidates
}

/**
 * Full detection pipeline for ONE key (SERVER-side):
 * candidates → parallel /models probes → chat verification with fall-through.
 * NOTE: some providers (Groq, OpenAI…) block datacenter IPs via Cloudflare —
 * keys that are actually valid fail here with HTTP 403. The client therefore
 * runs browserDetectKey() FIRST and only falls back to this pipeline.
 */
export async function detectKey(apiKey: string, endpoint?: string | null): Promise<DetectionResult> {
  /* ─── Step 1: build the ordered candidate list ─────────────────────── */
  const candidates = candidatesFor(apiKey, endpoint)

  /* ─── Step 2: probe ALL candidates' /models endpoints in PARALLEL ─── */
  const probes = await Promise.all(candidates.map(p => probeModels(p, apiKey)))
  const okProbes = probes.filter(r => r.ok)
  const failedProbes = probes.filter(r => !r.ok)

  if (okProbes.length === 0) {
    const keyHint = getKeyHint(apiKey)
    const prefixName = candidates[0]?.name
    let error = 'Could not verify this API key with any supported provider. '
    if (prefixName) {
      const wasBlocked = failedProbes.some(r => r.def.name === prefixName && /403/.test(r.error || ''))
      if (wasBlocked) {
        error += `${prefixName} is blocking THIS SERVER's region/IP (HTTP 403) — the block applies to every key, valid or not. `
        error += `Quick API Setup verifies from YOUR DEVICE first, so if this key is valid it should still succeed there. If it also fails on your device, the key itself is invalid, expired, or out of credit. `
      } else {
        error += `Your key looks like a ${prefixName} key, but ${prefixName} rejected it (HTTP ${failedProbes.find(r => r.def.name === prefixName)?.error?.match(/HTTP (\d+)/)?.[1] || '?'}). The key may be invalid, expired, revoked, or out of credit. `
        error += 'Double-check it on the provider dashboard, then try again. '
      }
    } else {
      error += 'The key format was not recognized and none of the 30+ supported providers accepted it. '
    }
    const tried = failedProbes.map(r => ({
      provider: r.def.name,
      status: r.error?.match(/HTTP (\d+)/)?.[1] || 'unknown',
      error: r.error || 'unknown',
    }))
    return { ok: false, error, keyHint, tried: tried.slice(0, 12), triedCount: tried.length }
  }

  /* ─── Step 3: verify candidates with a tiny chat call, best-first ──── */
  let winner: ProbeResult | null = null
  let verifyError = ''
  let verifiedModelId = ''
  const alternates: string[] = []

  for (const probe of okProbes) {
    if (probe.def.skipChatVerify) { winner = probe; break }
    // Verify with the BEST model; on 404 (model renamed/gated) or 402 (paid
    // model, free-only key) automatically try the next best models — the
    // saved agent must actually WORK, not just list models.
    const bestIds = sortModelsDefaultFirst(probe.models).map(m => m.id)
    const fallbackIds = bestIds.filter(id => id && id !== probe.models[0]?.id).slice(0, 3)
    const v = await verifyChat(probe.def, apiKey, probe.models[0]?.id, fallbackIds)
    if (v.ok) {
      winner = probe
      verifiedModelId = v.model || probe.models[0]?.id || ''
      break
    }
    verifyError = v.error || verifyError
    alternates.push(`${probe.def.name} (listed models but rejected chat: HTTP ${v.status || '?'})`)
  }

  if (!winner) {
    const first = okProbes[0]
    // v71 BOGUS-KEY GUARD: a PUBLIC /models list is NOT evidence of a real
    // key (OpenRouter and DeepInfra list models to anonymous callers, so a
    // garbage key used to "detect" as OpenRouter and get SAVED as a dead
    // agent). When EVERY chat verification ended in an AUTH rejection
    // (401/403) — and none in 402 (real key, out of credit) or 404 (model
    // renamed) — the key is simply invalid: fail honestly, save nothing.
    const errs = [verifyError, ...alternates].join(' ')
    const allAuthRejected = /HTTP 40[13]/.test(errs) && !/HTTP 40[24]/.test(errs)
    if (allAuthRejected) {
      return {
        ok: false,
        error: `${first.def.name} rejected this key (HTTP 401/403) and no other supported provider accepted it — the key is invalid, revoked, or a typo. Nothing was saved.`,
        keyHint: getKeyHint(apiKey),
        tried: alternates.map((a) => ({
          provider: a.split(' (')[0],
          status: a.match(/HTTP (\d+)/)?.[1] || 'unknown',
          error: a,
        })),
        triedCount: alternates.length,
      }
    }
    return {
      ok: true,
      detected: {
        providerKind: first.def.kind,
        providerName: first.def.name,
        endpoint: endpointOf(first.def),
        models: first.models,
        verified: false,
        verifyError: verifyError || `Key was rejected by ${first.def.name} chat API. Models listed below, but the key may be invalid or out of credit.`,
      },
      keyHint: getKeyHint(apiKey),
      alternates,
    }
  }

  return {
    ok: true,
    detected: {
      providerKind: winner.def.kind,
      providerName: winner.def.name,
      endpoint: endpointOf(winner.def),
      models: verifiedModelId
        ? (() => {
            // The chat-VERIFIED model (possibly a fallback that survived 402/404)
            // always leads the list — it is the saved default, so it must work.
            const sorted = sortModelsDefaultFirst(winner.models)
            const idx = sorted.findIndex(m => m.id === verifiedModelId)
            if (idx > 0) { const [m] = sorted.splice(idx, 1); sorted.unshift(m) }
            return sorted
          })()
        : sortModelsDefaultFirst(winner.models),
      verified: true,
      verifyError: '',
    },
    keyHint: getKeyHint(apiKey),
    alternates,
  }
}

/**
 * Grouping signature for BULK quick-setup: keys that share a signature are
 * assumed to belong to the same provider, so only ONE representative key per
 * group needs the full detection — the rest are saved instantly with the
 * same provider info. This makes pasting 500 Groq keys take seconds.
 */
export function prefixSignature(apiKey: string): string {
  const uniquePrefixes = [
    'gsk_', 'sk-or-', 'sk-ant-', 'sk-proj-', 'sk-svcacct-', 'AIza', 'xai-', 'pplx-',
    'hf_', 'ms-', 'github_pat_', 'ghp_', 'gho_', 'ghu_', 'r8_', 'bce-', 'eyJ', 'id.',
  ]
  for (const p of uniquePrefixes) {
    if (apiKey.startsWith(p)) return p
  }
  if (/^[a-z0-9]+\.[A-Za-z0-9]{20,}$/.test(apiKey)) return 'zai-id.secret'
  if (apiKey.startsWith('sk-')) return 'sk-'
  return 'other'
}
