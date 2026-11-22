/**
 * v111 — LOCAL OPEN-SOURCE AI (the "no API key" engine).
 *
 * Detects an open-source model server on the host (Ollama, llama.cpp,
 * LM Studio, vLLM — anything speaking the OpenAI-compatible protocol on
 * port 11434) and auto-provisions every installed model as a ready-to-use
 * AIProvider row: category 'free', tag 'local'. Users see these models in
 * the picker and can build complete apps WITHOUT ever adding an API key.
 *
 * Companion deliverable: scripts/setup-models.sh — run it once on your
 * production server and the 6-model catalog below is installed & served.
 *
 * Both servers are supported through the same OpenAI-compatible probe:
 *   Ollama   → serves /v1/models + /api/version + `ollama pull`
 *   llama.cpp→ serves /v1/models (llama-server, GGUF files)
 */
import { db } from '../db'

export const LOCAL_AI_BASE = (
  process.env.LOCAL_AI_BASE_URL ||
  process.env.OLLAMA_BASE_URL ||
  'http://127.0.0.1:11434'
).replace(/\/$/, '')

/** The open-source catalog the setup script installs (Ollama tags).
 *  v112 — added the owner's two requested families: GLM and OpenAI GPT-OSS.
 *  sizeGB/ramGB are honest minimums — the install grid blocks nothing, the
 *  host just needs the space (scripts/setup-models.sh pulls them). */
export interface LocalModelDef {
  tag: string
  name: string
  family: 'qwen' | 'deepseek' | 'llama' | 'gemma' | 'phi' | 'mistral' | 'glm' | 'gptoss'
  sizeGB: number
  ramGB: number
  strength: string
  ollamaName: string // the `ollama pull` name
}

export const LOCAL_MODEL_CATALOG: LocalModelDef[] = [
  { tag: 'qwen2.5-coder:7b', name: 'Qwen 2.5 Coder 7B', family: 'qwen', sizeGB: 4.7, ramGB: 6, strength: 'Best open coding model — app building workhorse', ollamaName: 'qwen2.5-coder:7b' },
  { tag: 'deepseek-coder:6.7b', name: 'DeepSeek Coder 6.7B', family: 'deepseek', sizeGB: 3.8, ramGB: 5, strength: 'Code specialist — strong at full-file generation', ollamaName: 'deepseek-coder:6.7b' },
  { tag: 'llama3.2:3b', name: 'Llama 3.2 3B', family: 'llama', sizeGB: 2.0, ramGB: 3, strength: 'Fast general model — UI copy, planning, small edits', ollamaName: 'llama3.2:3b' },
  { tag: 'gemma2:2b', name: 'Gemma 2 2B', family: 'gemma', sizeGB: 1.6, ramGB: 2.5, strength: 'Google compact — snappy on low-end hosts', ollamaName: 'gemma2:2b' },
  { tag: 'phi3.5:3.8b', name: 'Phi 3.5 Mini 3.8B', family: 'phi', sizeGB: 2.2, ramGB: 3, strength: 'Microsoft — strong reasoning per parameter', ollamaName: 'phi3.5:3.8b' },
  { tag: 'mistral:7b', name: 'Mistral 7B', family: 'mistral', sizeGB: 4.1, ramGB: 5, strength: 'Versatile instruct — good all-rounder', ollamaName: 'mistral:7b' },
  // v112 — GLM family (GLM open weights)
  { tag: 'glm4:9b', name: 'GLM 4 9B', family: 'glm', sizeGB: 5.6, ramGB: 8, strength: 'GLM open weights — strong bilingual coding & reasoning', ollamaName: 'glm4:9b' },
  // v112 — OpenAI GPT-OSS (the open-source GPT family)
  { tag: 'gpt-oss:20b', name: 'GPT-OSS 20B', family: 'gptoss', sizeGB: 13, ramGB: 16, strength: 'OpenAI open-source — flagship-quality reasoning (needs 16GB+ RAM host)', ollamaName: 'gpt-oss:20b' },
  { tag: 'gpt-oss:120b', name: 'GPT-OSS 120B', family: 'gptoss', sizeGB: 61, ramGB: 130, strength: 'OpenAI flagship open model — maximum quality (dedicated server)', ollamaName: 'gpt-oss:120b' },
]

export interface LocalServerStatus {
  up: boolean
  server: 'ollama' | 'llamacpp' | 'openai-compatible' | 'none'
  version: string | null
  base: string
  models: string[] // installed model ids from /v1/models
  error?: string
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(ms), cache: 'no-store' })
}

/** Probe the local model server. Cheap: two local fetches with short timeouts. */
export async function detectLocalServer(): Promise<LocalServerStatus> {
  const base = LOCAL_AI_BASE
  const out: LocalServerStatus = { up: false, server: 'none', version: null, base, models: [] }
  // 1. Ollama signature endpoint
  try {
    const r = await fetchWithTimeout(`${base}/api/version`, 900)
    if (r.ok) {
      const j = await r.json().catch(() => ({}))
      out.up = true
      out.server = 'ollama'
      out.version = j?.version || 'unknown'
    }
  } catch { /* not ollama (or down) */ }
  // 2. OpenAI-compatible /v1/models — Ollama AND llama.cpp AND vLLM all serve it
  try {
    const r = await fetchWithTimeout(`${base}/v1/models`, 1500)
    if (r.ok) {
      const j = await r.json().catch(() => ({}))
      const ids: string[] = Array.isArray(j?.data)
        ? j.data.map((m: any) => String(m?.id || '')).filter(Boolean)
        : []
      out.up = true
      out.models = ids
      if (out.server === 'none') out.server = 'openai-compatible'
    } else if (out.up) {
      // server answered /api/version but not /v1/models — still ollama, just busy
    }
  } catch (e: any) {
    if (!out.up) out.error = String(e?.message || 'connection refused')
  }
  return out
}

/** "qwen2.5-coder:0.5b" → "Qwen 2.5 Coder (0.5b) · local"
 *  v112: GGUF file stems carry quant tags ("…-Q4_K_M") — stripped for display. */
export function prettyLocalModelName(tag: string): string {
  const [rawBase, rawSize] = String(tag).split(':')
  const base = rawBase
    .replace(/[-_]?i?q[0-9](_?k)?(_?(m|s|0|xs|xxs|xl|sx))?$/i, '') // trailing quant tag (Q4_K_M, Q8_0, IQ3_XXS…)
    .replace(/[-_]/g, ' ')
    .trim()
  const FAMILIES: Array<[RegExp, string]> = [
    [/^qwen/i, 'Qwen'],
    [/^deepseek/i, 'DeepSeek'],
    [/^llama/i, 'Llama'],
    [/^gemma/i, 'Gemma'],
    [/^phi/i, 'Phi'],
    [/^mistral|^mixtral/i, 'Mistral'],
    [/^glm/i, 'GLM'],
    [/^gpt-?oss/i, 'GPT-OSS'],
    [/^smollm/i, 'SmolLM'],
    [/^tinyllama/i, 'TinyLlama'],
  ]
  const words = base.split(/\s+/).map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
  let pretty = words.join(' ')
  for (const [re, fam] of FAMILIES) {
    if (re.test(base)) { pretty = fam + pretty.slice(fam.length); break }
  }
  return rawSize ? `${pretty} (${rawSize}) · local` : `${pretty} · local`
}

/**
 * Sync: for every model the local server reports, ensure an AIProvider row
 * exists (kind 'local', category 'free', tag 'local') so it appears in the
 * model picker with ZERO user configuration. Idempotent; safe to call on
 * every boot and from the admin Rescan button.
 */
export async function syncLocalProviders(): Promise<{ created: number; updated: number; up: boolean; server: string; models: string[] }> {
  const status = await detectLocalServer()
  if (!status.up) return { created: 0, updated: 0, up: false, server: status.server, models: [] }
  const rows = await db.aIProvider.findMany({ where: { kind: 'local' } })
  let created = 0
  let updated = 0
  for (const modelId of status.models) {
    const existing = rows.find((r) => r.model === modelId)
    if (existing) {
      if (existing.endpoint !== `${LOCAL_AI_BASE}/v1`) {
        await db.aIProvider.update({ where: { id: existing.id }, data: { endpoint: `${LOCAL_AI_BASE}/v1` } }).catch(() => {})
        updated++
      }
      continue
    }
    await db.aIProvider.create({
      data: {
        name: prettyLocalModelName(modelId),
        kind: 'local',
        endpoint: `${LOCAL_AI_BASE}/v1`,
        apiKeyEnc: null, // open-source model on our own server — no key exists
        model: modelId,
        temperature: 0.7,
        maxTokens: 16384,
        category: 'free',
        tag: 'local',
        role: 'work',
        isDefault: false,
      },
    }).catch(() => {})
    created++
  }
  return { created, updated, up: true, server: status.server, models: status.models }
}

/** Admin: start `ollama pull <model>` detached (never blocks the request). */
export async function startOllamaPull(tag: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { spawn } = await import('child_process')
    const child = spawn('ollama', ['pull', tag], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
      env: { ...process.env, OLLAMA_HOST: LOCAL_AI_BASE },
    })
    child.on('error', () => { /* ollama binary absent — status endpoint stays honest */ })
    child.unref()
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'could not spawn ollama' }
  }
}
