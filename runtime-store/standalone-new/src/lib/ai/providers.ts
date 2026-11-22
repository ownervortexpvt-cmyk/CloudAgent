/**
 * AI Provider abstraction layer.
 *
 * Defines an `AIProvider` interface that every concrete provider implements.
 * Concrete implementations:
 *   - ZAIProvider           (built-in via z-ai-web-dev-sdk — used as default demo)
 *   - OpenAIProvider        (openai.com / any OpenAI-compatible endpoint)
 *   - OpenAICompatibleProvider (generic /v1/chat/completions adapters)
 *   - ClaudeProvider        (Anthropic /v1/messages)
 *   - GeminiProvider        (Google generative-language /v1beta)
 *   - GroqProvider          (groq.com — uses OpenAI-compatible API)
 *   - OpenRouterProvider    (openrouter.ai — OpenAI-compatible)
 *   - CustomProvider        (totally custom — placeholder for user-defined)
 *
 * API keys live ONLY on the server. The client never receives raw keys.
 */
import { db } from '../db'
import { decrypt } from '../crypto'
import { LOCAL_AI_BASE } from './local'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name?: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
  /** v166 — SDK thinking mode passthrough (glm deep reasoning). Lanes set
   *  this per role; plain chat/stream only — tool loops stay disabled (v29). */
  thinking?: 'enabled' | 'disabled'
  /** v30 SPEED — live content deltas from streaming tool turns. Lets the
   *  agent loop keep the NDJSON stream (and the UI) alive during long
   *  code-generation turns instead of silence until the turn completes. */
  onDelta?: (t: string) => void
}

export interface ChatResponse {
  content: string
  role: 'assistant'
  toolCalls?: ChatMessage['tool_calls']
  raw?: any
  tokensIn?: number
  tokensOut?: number
  finishReason?: string
}

export interface ToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, any> // JSON schema
  }
}

export interface AIProvider {
  readonly kind: string
  readonly displayName: string
  readonly model: string
  supportsTools(): boolean
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse>
  stream(messages: ChatMessage[], opts: ChatOptions & { onToken?: (t: string) => void }): Promise<ChatResponse>
  chatWithTools(messages: ChatMessage[], tools: ToolDef[], opts?: ChatOptions): Promise<ChatResponse>
}

async function fetchJson(url: string, init: RequestInit, opts: { signal?: AbortSignal } = {}) {
  const res = await fetch(url, { ...init, signal: opts.signal })
  const text = await res.text()
  let body: any
  try { body = JSON.parse(text) } catch { body = { raw: text } }
  if (!res.ok) {
    // Extract the most useful error message from the response
    let errMsg = ''
    if (body?.error?.message) errMsg = body.error.message
    else if (body?.message) errMsg = body.message
    else if (body?.error) errMsg = typeof body.error === 'string' ? body.error : JSON.stringify(body.error).slice(0, 200)
    else errMsg = text.slice(0, 200)

    // Map common HTTP status codes to helpful messages
    let hint = ''
    if (res.status === 400) hint = ' — Bad request. The model rejected the payload (context too long, malformed tool call, or unsupported parameter). Try a fresh run or a different model.'
    else if (res.status === 401) hint = ' — API key is invalid or missing. Check your key.'
    else if (res.status === 402) hint = ' — This key is VALID but the account is OUT OF CREDIT. Top up on the provider dashboard, or let another agent take over.'
    else if (res.status === 403) hint = ' — API key is valid but access forbidden. Key may be expired or rate-limited.'
    else if (res.status === 404) hint = ' — Model not found. It may be retired (Gemini 1.5 is gone) — Provider Manager → 🛠 Auto-fix repairs stale names, or pick a model from the live list.'
    else if (res.status === 405) hint = ' — Method not allowed. The endpoint does not accept this request (wrong URL path or method) — re-check the provider endpoint.'
    else if (res.status === 408) hint = ' — Request timeout upstream. Retrying usually fixes it.'
    else if (res.status === 429) hint = ' — Rate limit exceeded. Wait a moment and try again.'
    else if (res.status === 500) hint = ' — Server error. Try again.'
    else if (res.status === 501) hint = ' — Not implemented. The endpoint does not support this feature (e.g. tool calling) — pick a provider that does.'
    else if (res.status === 502 || res.status === 503) hint = ' — Provider temporarily unavailable (bad gateway / overloaded). The agent will fail over automatically; retry shortly.'
    else if (res.status === 504) hint = ' — Gateway timeout — the model took too long upstream. Try a smaller task or another provider.'

    throw new Error(`HTTP ${res.status}${hint}\n${errMsg}`)
  }
  return body
}

/* ----------------------------- ZAI (built-in) ---------------------------- */
export class ZAIProvider implements AIProvider {
  readonly kind = 'zai'
  readonly displayName: string
  readonly model: string
  constructor(model = 'glm-4.6', displayName = 'GLM (built-in)') {
    this.model = model
    this.displayName = displayName
  }
  supportsTools() { return true }

  private async sdk() {
    const mod = await import('z-ai-web-dev-sdk')
    return mod.default || mod
  }

  /**
   * v29 SPEED: the SDK client is created ONCE per process instead of on
   * every single chat/chatWithTools call — ZAI.create() does config+crypto
   * init each time, which multiplied across an agent run (dozens of tool
   * turns) added real seconds. HMR-safe via globalThis.
   */
  private static clientPromise: Promise<any> | null = null
  private async client() {
    const g = globalThis as any
    if (!g.__caZaiClient) {
      g.__caZaiClient = (async () => {
        const ZAI = await this.sdk()
        return ZAI.create()
      })()
    }
    return g.__caZaiClient
  }

  /**
   * FIX (429 burst collapse): every built-in Vortex Engine provider row (glm-5.3-flash / 5.3 /
   * 4.6) shares ONE free-tier quota. A parallel swarm fires 4+ model calls at
   * the same instant → instant 429 for all of them → the run collapses with
   * no files written. This module-level gate serializes the REQUEST STARTS
   * (spacing them out with jitter) while still allowing long streaming calls
   * to overlap once started. Costs ~1s per queued call, saves whole runs.
   */
  private static async gate() {
    const g = globalThis as any
    g.__caZaiGate ??= Promise.resolve()
    const MIN_SPACING = 900 + Math.floor(Math.random() * 400)
    const myTurn = g.__caZaiGate.then(() => new Promise(r => setTimeout(r, MIN_SPACING)))
    g.__caZaiGate = myTurn
    await myTurn
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResponse> {
    await ZAIProvider.gate()
    const zai = await this.client()
    const system = messages.find(m => m.role === 'system')?.content
    const conv = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    const res = await zai.chat.completions.create({
      messages: conv,
      model: this.model,
      temperature: opts.temperature ?? 0.7,
      thinking: { type: opts.thinking || 'disabled' },
      ...(system ? { system } : {}),
    } as any)
    const content = (res as any)?.choices?.[0]?.delta?.content || (res as any)?.choices?.[0]?.message?.content || ''
    return { content, role: 'assistant', tokensIn: (res as any)?.usage?.prompt_tokens, tokensOut: (res as any)?.usage?.completion_tokens, raw: res }
  }

  async stream(messages: ChatMessage[], opts: ChatOptions & { onToken?: (t: string) => void } = {}): Promise<ChatResponse> {
    await ZAIProvider.gate()
    const zai = await this.client()
    const system = messages.find(m => m.role === 'system')?.content
    const conv = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    let full = ''
    try {
      const stream = await zai.chat.completions.create({
        messages: conv,
        model: this.model,
        temperature: opts.temperature ?? 0.7,
        thinking: { type: opts.thinking || 'disabled' },
        stream: true,
        ...(system ? { system } : {}),
      } as any)
      for await (const chunk of stream as any) {
        const t = chunk?.choices?.[0]?.delta?.content || chunk?.choices?.[0]?.message?.content || ''
        if (t) { full += t; opts.onToken?.(t) }
      }
    } catch {
      const r = await this.chat(messages, opts)
      opts.onToken?.(r.content)
      return r
    }
    return { content: full, role: 'assistant' }
  }

  async chatWithTools(messages: ChatMessage[], tools: ToolDef[], opts: ChatOptions = {}): Promise<ChatResponse> {
    await ZAIProvider.gate()
    const zai = await this.client()
    const system = messages.find(m => m.role === 'system')?.content
    const conv = messages.filter(m => m.role !== 'system').map(m => {
      // Pass through tool_calls on assistant messages and tool results on tool messages
      const out: any = { role: m.role, content: m.content }
      if (m.tool_call_id) out.tool_call_id = m.tool_call_id
      if (m.tool_calls) out.tool_calls = m.tool_calls
      if (m.name) out.name = m.name
      return out
    })
    const reqBase = {
      messages: conv,
      model: this.model,
      temperature: opts.temperature ?? 0.7,
      tools: tools as any,
      tool_choice: 'auto' as const,
      // v30 SPEED: without an explicit output ceiling some responses get
      // truncated mid-arguments. 16384 tokens ≈ a 3-5 file batch (~50KB of
      // code) — verified reachable, still bounded inside the 600s turn cap.
      max_tokens: opts.maxTokens || 16384,
      // v29 SPEED: hidden chain-of-thought on every tool turn burns big
      // wall-clock time. GLM-4.6 is a strong non-thinking coder; the QA
      // loops catch what it misses. Disable thinking on the TOOL loop only.
      thinking: { type: 'disabled' },
      ...(system ? { system } : {}),
    }

    // ── v30 SPEED — STREAM the tool turn instead of one blocking call ────────
    // The old blocking path froze the ENTIRE run when the provider stalled:
    // a real big-app build hung 10+ minutes after its second file because
    // the model call never returned and had NO timeout (the two "running"
    // AgentRun rows that never finish). Streaming gives us:
    //   - stall detection: no chunk for IDLE_MS → abort → automatic retry
    //   - a hard turn cap (HARD_MS) for pathological hangs
    //   - 2 fast retries before the blocking fallback below
    // Same wire protocol (OpenAI-compatible), just observed chunk by chunk.
    const IDLE_MS = 150_000
    const HARD_MS = 600_000

    // v30 SPEED: the GLM SDK accepts stream:true but, WITH tools attached,
    // resolves a single EMPTY chunk (verified by raw probe — no content, no
    // tool_calls, no usage). Streaming tool turns are therefore impossible
    // on this SDK; after the first discovery, remember it process-wide so no
    // run ever wastes 3 empty round-trips per turn again. HMR-safe.
    const g = globalThis as any
    if (!('__caZaiStreamToolsBroken' in g)) g.__caZaiStreamToolsBroken = false

    for (let attempt = 1; attempt <= 3 && !g.__caZaiStreamToolsBroken; attempt++) {
      try {
        const stream: any = await Promise.race([
          zai.chat.completions.create({ ...reqBase, stream: true } as any),
          new Promise((_, rej) => setTimeout(() => rej(new Error('stream open exceeded 60s')), 60_000)),
        ])
        let content = ''
        const acc = new Map<number, { id: string; name: string; args: string }>()
        let usage: any = null
        let finishReason: string | null = null

        // v30 SPEED — consume the stream through the RAW async-iterator
        // protocol with a per-chunk idle race. The previous version trusted
        // `for await` + stream.return()/controller.abort() to escape a stall
        // — this SDK's stream implements neither, so a silent provider still
        // froze the run (observed live: AgentRun stuck "running" for 25+
        // minutes with zero events). Racing every it.next() against the idle
        // timer guarantees we ALWAYS escape, no matter what the SDK supports.
        const it = (typeof stream?.[Symbol.asyncIterator] === 'function')
          ? stream[Symbol.asyncIterator]()
          : null
        if (!it) throw new Error('stream is not an async iterator')
        const nextChunk = () => Promise.race([
          it.next(),
          new Promise<never>((_, rej) => setTimeout(() => {
            try { it.return?.() } catch { /* best effort */ }
            rej(new Error(`provider stalled — no chunk for ${Math.round(IDLE_MS / 1000)}s`))
          }, IDLE_MS)),
        ])
        while (true) {
          const { done: chunkDone, value: chunk } = await nextChunk()
          if (chunkDone) break
          const choice = chunk?.choices?.[0]
          const d = choice?.delta || choice?.message
          if (d?.content) {
            content += d.content
            if (choice?.delta?.content) opts.onDelta?.(choice.delta.content) // real deltas only — never re-emit a reconstructed message
          }
          if (Array.isArray(d?.tool_calls)) {
            for (const tc of d.tool_calls) {
              const i = Number(tc.index ?? 0)
              const cur = acc.get(i) || { id: '', name: '', args: '' }
              if (tc.id) cur.id = tc.id
              if (tc.function?.name) cur.name = tc.function.name
              if (tc.function?.arguments) cur.args += tc.function.arguments
              acc.set(i, cur)
            }
          }
          if (chunk?.usage) usage = chunk.usage
          if (choice?.finish_reason) finishReason = choice.finish_reason
        }
        const toolCalls = [...acc.values()]
          .filter(t => t.name)
          .map(t => ({
            id: t.id || `call_${t.name}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'function' as const,
            function: { name: t.name, arguments: t.args || '{}' },
          }))
        if (!content && toolCalls.length === 0) throw new Error('empty streamed completion')
        return {
          content,
          role: 'assistant',
          toolCalls: toolCalls as any,
          tokensIn: usage?.prompt_tokens,
          tokensOut: usage?.completion_tokens,
          finishReason: finishReason || undefined,
          raw: { choices: [{ message: { content }, finish_reason: finishReason }], usage },
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (/empty streamed completion/i.test(msg)) {
          // SDK does not really stream with tools — never try again this process.
          g.__caZaiStreamToolsBroken = true
          break
        }
        if (/429|rate.?limit|quota/i.test(msg)) break // fail fast to the fallback — retries cannot fix throttling
        if (attempt < 3) continue // stall / hiccup — fresh streaming attempt
        // Third failure → fall through to the hardened blocking fallback.
      }
    }

    try {
      // Blocking fallback (original path) — now with a HARD CAP so even the
      // fallback can never freeze a run forever again.
      const res: any = await Promise.race([
        zai.chat.completions.create(reqBase as any),
        new Promise((_, rej) => setTimeout(() => rej(new Error('blocking model call exceeded 600s')), HARD_MS)),
      ])
      const choice = res?.choices?.[0]
      const content = choice?.message?.content || ''
      const toolCalls = choice?.message?.tool_calls
      return {
        content,
        role: 'assistant',
        toolCalls,
        tokensIn: res?.usage?.prompt_tokens,
        tokensOut: res?.usage?.completion_tokens,
        finishReason: choice?.finish_reason,
        raw: res,
      }
    } catch (e) {
      // Fallback to non-tool chat if tool calling fails (some ZAI models may not support it)
      const res = await this.chat(messages, opts)
      const toolCalls = parseToolCallsFromText(res.content)
      return { ...res, toolCalls }
    }
  }
}

/* ------------------------------ OpenAI family ----------------------------- */
export class OpenAIProvider implements AIProvider {
  readonly kind: string = 'openai'
  readonly displayName: string
  readonly model: string
  protected endpoint: string
  protected apiKey: string
  constructor(opts: { apiKey: string; model: string; endpoint?: string; displayName?: string; kind?: string }) {
    this.apiKey = opts.apiKey
    this.model = opts.model
    this.endpoint = (opts.endpoint || 'https://api.openai.com/v1').replace(/\/$/, '')
    this.displayName = opts.displayName || 'OpenAI'
  }
  supportsTools() { return true }

  protected toOpenAIMessages(messages: ChatMessage[]): any[] {
    return messages.map(m => {
      const out: any = { role: m.role, content: m.content }
      if (m.tool_call_id) out.tool_call_id = m.tool_call_id
      if (m.tool_calls) out.tool_calls = m.tool_calls
      if (m.name) out.name = m.name
      return out
    })
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResponse> {
    const body: any = {
      model: this.model,
      messages: this.toOpenAIMessages(messages),
      temperature: opts.temperature ?? 0.7,
    }
    if (opts.maxTokens) body.max_tokens = opts.maxTokens
    const res = await fetchJson(`${this.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    }, { signal: opts.signal })
    const choice = res.choices?.[0]
    return {
      content: choice?.message?.content || '',
      role: 'assistant',
      toolCalls: choice?.message?.tool_calls,
      tokensIn: res.usage?.prompt_tokens,
      tokensOut: res.usage?.completion_tokens,
      finishReason: choice?.finish_reason,
      raw: res,
    }
  }

  async stream(messages: ChatMessage[], opts: ChatOptions & { onToken?: (t: string) => void } = {}): Promise<ChatResponse> {
    const body: any = {
      model: this.model,
      messages: this.toOpenAIMessages(messages),
      temperature: opts.temperature ?? 0.7,
      stream: true,
    }
    if (opts.maxTokens) body.max_tokens = opts.maxTokens
    const res = await fetch(`${this.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
      signal: opts.signal,
    })
    if (!res.ok || !res.body) {
      const r = await this.chat(messages, opts)
      opts.onToken?.(r.content)
      return r
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let full = ''
    let toolCalls: any
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        const t = line.trim()
        if (!t || !t.startsWith('data:')) continue
        const data = t.slice(5).trim()
        if (data === '[DONE]') continue
        try {
          const obj = JSON.parse(data)
          const delta = obj.choices?.[0]?.delta
          if (delta?.content) { full += delta.content; opts.onToken?.(delta.content) }
          if (delta?.tool_calls) toolCalls = (toolCalls || []).concat(delta.tool_calls)
        } catch {}
      }
    }
    return { content: full, role: 'assistant', toolCalls }
  }

  async chatWithTools(messages: ChatMessage[], tools: ToolDef[], opts: ChatOptions = {}): Promise<ChatResponse> {
    const body: any = {
      model: this.model,
      messages: this.toOpenAIMessages(messages),
      tools,
      tool_choice: 'auto',
      temperature: opts.temperature ?? 0.7,
    }
    if (opts.maxTokens) body.max_tokens = opts.maxTokens
    const res = await fetchJson(`${this.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    }, { signal: opts.signal })
    const choice = res.choices?.[0]
    return {
      content: choice?.message?.content || '',
      role: 'assistant',
      toolCalls: choice?.message?.tool_calls,
      tokensIn: res.usage?.prompt_tokens,
      tokensOut: res.usage?.completion_tokens,
      finishReason: choice?.finish_reason,
      raw: res,
    }
  }
}

export class OpenAICompatibleProvider extends OpenAIProvider {
  readonly kind: string
  readonly displayName: string
  constructor(opts: { apiKey: string; model: string; endpoint: string; displayName?: string }) {
    super(opts)
    this.kind = 'openai-compatible'
    this.displayName = opts.displayName || 'OpenAI-Compatible'
  }
}

export class GroqProvider extends OpenAICompatibleProvider {
  constructor(opts: { apiKey: string; model: string }) {
    super({ ...opts, endpoint: 'https://api.groq.com/openai/v1', displayName: 'Groq' })
  }
}

export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(opts: { apiKey: string; model: string }) {
    super({ ...opts, endpoint: 'https://openrouter.ai/api/v1', displayName: 'OpenRouter' })
  }
}

/* --------------------------------- Claude -------------------------------- */
export class ClaudeProvider implements AIProvider {
  readonly kind = 'claude'
  readonly displayName = 'Claude'
  readonly model: string
  protected apiKey: string
  protected endpoint: string
  constructor(opts: { apiKey: string; model: string; endpoint?: string }) {
    this.apiKey = opts.apiKey
    this.model = opts.model
    this.endpoint = (opts.endpoint || 'https://api.anthropic.com/v1').replace(/\/$/, '')
  }
  supportsTools() { return true }

  private splitMessages(messages: ChatMessage[]): { system: string; conv: any[] } {
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')
    const conv: any[] = []
    for (const m of messages) {
      if (m.role === 'system') continue
      if (m.role === 'assistant' && m.tool_calls) {
        conv.push({
          role: 'assistant',
          content: [
            ...(m.content ? [{ type: 'text', text: m.content }] : []),
            ...m.tool_calls.map(tc => {
              let input: any = {}
              try { input = JSON.parse(tc.function.arguments || '{}') } catch {}
              return { type: 'tool_use', id: tc.id, name: tc.function.name, input }
            }),
          ],
        })
        continue
      }
      if (m.role === 'tool') {
        // The Anthropic API REQUIRES alternating user/assistant roles and
        // tool_result blocks must live INSIDE a user message. Parallel tool
        // calls produce N consecutive role:'tool' messages — merge them into
        // the trailing user message instead of emitting N user turns
        // (previously every multi-tool step failed with HTTP 400).
        const last = conv[conv.length - 1]
        const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }
        if (last && last.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') {
          last.content.push(block)
        } else {
          conv.push({ role: 'user', content: [block] })
        }
        continue
      }
      conv.push({ role: m.role as 'user' | 'assistant', content: m.content })
    }
    return { system, conv }
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResponse> {
    const { system, conv } = this.splitMessages(messages)
    const body: any = {
      model: this.model,
      messages: conv,
      max_tokens: opts.maxTokens ?? 200000,
      temperature: opts.temperature ?? 0.7,
    }
    if (system) body.system = system
    const res = await fetchJson(`${this.endpoint}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    }, { signal: opts.signal })
    const content = (res.content || []).map((c: any) => c.type === 'text' ? c.text : '').join('')
    const toolUses = (res.content || []).filter((c: any) => c.type === 'tool_use').map((c: any) => ({
      id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input || {}) }
    }))
    return { content, role: 'assistant', toolCalls: toolUses.length ? toolUses : undefined, tokensIn: res.usage?.input_tokens, tokensOut: res.usage?.output_tokens, finishReason: res.stop_reason, raw: res }
  }

  async stream(messages: ChatMessage[], opts: ChatOptions & { onToken?: (t: string) => void } = {}): Promise<ChatResponse> {
    const { system, conv } = this.splitMessages(messages)
    const body: any = {
      model: this.model,
      messages: conv,
      max_tokens: opts.maxTokens ?? 200000,
      temperature: opts.temperature ?? 0.7,
      stream: true,
    }
    if (system) body.system = system
    const res = await fetch(`${this.endpoint}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    })
    if (!res.ok || !res.body) {
      const r = await this.chat(messages, opts)
      opts.onToken?.(r.content)
      return r
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let full = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const data = t.slice(5).trim()
        if (data === '[DONE]') continue
        try {
          const obj = JSON.parse(data)
          if (obj.type === 'content_block_delta' && obj.delta?.text) {
            full += obj.delta.text
            opts.onToken?.(obj.delta.text)
          }
        } catch {}
      }
    }
    return { content: full, role: 'assistant' }
  }

  async chatWithTools(messages: ChatMessage[], tools: ToolDef[], opts: ChatOptions = {}): Promise<ChatResponse> {
    const { system, conv } = this.splitMessages(messages)
    const body: any = {
      model: this.model,
      messages: conv,
      max_tokens: opts.maxTokens ?? 200000,
      tools: tools.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })),
    }
    if (system) body.system = system
    const res = await fetchJson(`${this.endpoint}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    }, { signal: opts.signal })
    const content = (res.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
    const toolUses = (res.content || []).filter((c: any) => c.type === 'tool_use').map((c: any) => ({
      id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input || {}) }
    }))
    return { content, role: 'assistant', toolCalls: toolUses.length ? toolUses : undefined, tokensIn: res.usage?.input_tokens, tokensOut: res.usage?.output_tokens, finishReason: res.stop_reason, raw: res }
  }
}

/* --------------------------------- Gemini -------------------------------- */
export class GeminiProvider implements AIProvider {
  readonly kind = 'gemini'
  readonly displayName = 'Gemini'
  /** v68: writable — the stale-model self-heal (404 → ListModels → retry)
   *  re-points the model for the lifetime of this provider instance. */
  model: string
  protected apiKey: string
  protected endpoint: string
  constructor(opts: { apiKey: string; model: string; endpoint?: string }) {
    this.apiKey = opts.apiKey
    // v68: tolerate pasted "models/gemini-..." ids and stray whitespace —
    // Google 404s on the prefixed form.
    this.model = String(opts.model || '').trim().replace(/^models\//, '')
    this.endpoint = (opts.endpoint || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '')
  }
  supportsTools() { return true }

  /** v68 STALE-MODEL SELF-HEAL — Google retires model names (the whole 1.5
   *  family and the -001 suffixes are gone, so saved providers 404 with
   *  "Models not found. Check the model name."). Instead of dying, ask
   *  ListModels what this key can STILL call and re-point at the best
   *  chat-capable model. */
  private async listChatModels(): Promise<string[]> {
    try {
      const res = await fetchJson(`${this.endpoint}/models?pageSize=1000`, {
        method: 'GET',
        headers: { 'x-goog-api-key': this.apiKey },
      }, {})
      const rows: any[] = Array.isArray(res?.models) ? res.models : []
      return rows
        .filter((m) => !m.deprecated && (!Array.isArray(m.supportedGenerationMethods) || m.supportedGenerationMethods.includes('generateContent')))
        .map((m) => String(m.name || '').replace(/^models\//, '').trim())
        .filter(Boolean)
    } catch {
      return []
    }
  }

  /** First live match wins, newest family first. */
  private static FALLBACK_MODELS = [
    'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite',
    'gemini-flash-latest', 'gemini-2.0-flash', 'gemini-2.0-flash-lite',
  ]

  /** v72 FIX — ordered heal CANDIDATES (not a single pick). The old heal
   *  chose exactly one fuzzy replacement and prayed: a listed-but-not-yet-
   *  callable name (Google stages models — ListModels shows them while
   *  generateContent still 404s) made the retry 404 too and the whole call
   *  died. Now the caller walks the list until one model actually answers. */
  private async healCandidates(): Promise<string[]> {
    const live = await this.listChatModels()
    if (!live.length) return []
    const order: string[] = []
    const push = (m: string | undefined | null) => { if (m && !order.includes(m)) order.push(m) }
    // Tier-preserving: a saved -pro heals to the newest pro first, anything
    // else prefers the fast flash family (same semantics as fix-model).
    for (const cand of (/pro/i.test(this.model)
      ? ['gemini-2.5-pro', ...GeminiProvider.FALLBACK_MODELS]
      : GeminiProvider.FALLBACK_MODELS)) {
      if (live.includes(cand)) push(cand)
    }
    // Fuzzy: same-tier flash picks first, pro next, then EVERYTHING live —
    // each entry is one more chance that a staged/retiring list still has a
    // genuinely callable model. Capped so a pathological list cannot loop.
    for (const m of live.filter((x) => /flash/.test(x) && !/lite/.test(x))) push(m)
    for (const m of live.filter((x) => /pro/.test(x))) push(m)
    for (const m of live) push(m)
    return order.slice(0, 8)
  }

  /** generateContent POST with the self-heal wrapper: on HTTP 404 the model
   *  is discovered live and the call is retried with heal candidates until
   *  one actually answers (heals stick, so a whole agent run pays discovery
   *  at most once). */
  private async generate(body: any, opts: ChatOptions): Promise<any> {
    const call = (model: string) => fetchJson(`${this.endpoint}/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
    }, { signal: opts.signal })
    try {
      return await call(this.model)
    } catch (e: any) {
      if (!/^HTTP 404\b/.test(String(e?.message || ''))) throw e
      const candidates = await this.healCandidates()
      const dead = this.model
      let lastErr: any = e
      for (const cand of candidates) {
        if (cand === dead) continue
        try {
          const r = await call(cand)
          this.model = cand // heal sticks for this provider instance
          return r
        } catch (e2: any) {
          lastErr = e2
          if (!/^HTTP 404\b/.test(String(e2?.message || ''))) throw e2 // auth/other → honest verdict
        }
      }
      if (candidates.length === 0) {
        throw new Error(`HTTP 404 — Model "${dead}" is retired and no chat model could be auto-discovered with this key. Check the key in Provider Manager.`)
      }
      throw lastErr // every candidate 404'd — surface the honest last error
    }
  }

  private toGeminiContents(messages: ChatMessage[]): any[] {
    const out: any[] = []
    for (const m of messages) {
      if (m.role === 'system') continue
      if (m.role === 'assistant' && m.tool_calls) {
        out.push({
          role: 'model',
          parts: [
            ...(m.content ? [{ text: m.content }] : []),
            ...m.tool_calls.map(tc => {
              let args: any = {}
              try { args = JSON.parse(tc.function.arguments || '{}') } catch {}
              return { functionCall: { name: tc.function.name, args } }
            }),
          ],
        })
        continue
      }
      if (m.role === 'tool') {
        // Function responses must be returned in a 'user' turn with the
        // functionResponse part shape (plain text used to be invalid)
        let resultObj: any = { result: m.content }
        try { resultObj = JSON.parse(m.content) } catch {}
        out.push({
          role: 'user',
          parts: [{ functionResponse: { name: m.name || 'tool', response: resultObj } }],
        })
        continue
      }
      out.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })
    }
    return out
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResponse> {
    const system = messages.find(m => m.role === 'system')?.content
    const body: any = {
      contents: this.toGeminiContents(messages),
      generationConfig: { temperature: opts.temperature ?? 0.7, ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}) },
    }
    if (system) body.systemInstruction = { parts: [{ text: system }] }
    // v68: goes through the stale-model self-heal wrapper (404 → discover → retry)
    const res = await this.generate(body, opts)
    const text = (res.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('')
    return { content: text, role: 'assistant', tokensIn: res.usageMetadata?.promptTokenCount, tokensOut: res.usageMetadata?.candidatesTokenCount, finishReason: res.candidates?.[0]?.finishReason, raw: res }
  }

  async stream(messages: ChatMessage[], opts: ChatOptions & { onToken?: (t: string) => void } = {}): Promise<ChatResponse> {
    const system = messages.find(m => m.role === 'system')?.content
    const body: any = {
      contents: this.toGeminiContents(messages),
      generationConfig: { temperature: opts.temperature ?? 0.7, ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}) },
    }
    if (system) body.systemInstruction = { parts: [{ text: system }] }
    const res = await fetch(`${this.endpoint}/models/${this.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    })
    if (!res.ok || !res.body) {
      const r = await this.chat(messages, opts)
      opts.onToken?.(r.content)
      return r
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let full = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const data = t.slice(5).trim()
        if (data === '[DONE]') continue
        try {
          const obj = JSON.parse(data)
          const text = (obj.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('')
          if (text) { full += text; opts.onToken?.(text) }
        } catch {}
      }
    }
    return { content: full, role: 'assistant' }
  }

  async chatWithTools(messages: ChatMessage[], tools: ToolDef[], opts: ChatOptions = {}): Promise<ChatResponse> {
    // Real function-calling support: pass tools as functionDeclarations and
    // map functionCall parts back to OpenAI-style tool_calls. Previously this
    // silently dropped the tools argument, so Gemini could never call tools.
    const system = messages.find(m => m.role === 'system')?.content
    const body: any = {
      contents: this.toGeminiContents(messages),
      generationConfig: { temperature: opts.temperature ?? 0.7, ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}) },
      tools: [{
        functionDeclarations: tools.map(t => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      }],
    }
    if (system) body.systemInstruction = { parts: [{ text: system }] }
    // v68: self-heal wrapper here too — tool-calling runs hit the same 404s
    const res = await this.generate(body, opts)
    const parts = res.candidates?.[0]?.content?.parts || []
    const text = parts.map((p: any) => p.text || '').join('')
    const calls = parts.filter((p: any) => p.functionCall).map((p: any, i: number) => ({
      id: `gem_call_${Date.now()}_${i}`,
      type: 'function' as const,
      function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) },
    }))
    return {
      content: text,
      role: 'assistant',
      toolCalls: calls.length ? calls : undefined,
      tokensIn: res.usageMetadata?.promptTokenCount,
      tokensOut: res.usageMetadata?.candidatesTokenCount,
      finishReason: res.candidates?.[0]?.finishReason,
      raw: res,
    }
  }
}

/* -------------------------------- Custom --------------------------------- */
export class CustomProvider extends OpenAICompatibleProvider {
  constructor(opts: { apiKey: string; model: string; endpoint: string; displayName?: string }) {
    super({ ...opts, displayName: opts.displayName || 'Custom' })
  }
  readonly kind = 'custom' as any
}
/* ------------------------------ Factory layer ----------------------------- */
export async function getProviderById(providerId: string): Promise<AIProvider> {
  const row = await db.aIProvider.findUnique({ where: { id: providerId } })
  if (!row) throw new Error(`Provider ${providerId} not found`)
  return buildProvider({
    kind: row.kind as any,
    name: row.name,
    endpoint: row.endpoint || undefined,
    apiKey: row.apiKeyEnc ? decrypt(row.apiKeyEnc) : '',
    model: row.model,
    temperature: row.temperature,
    maxTokens: row.maxTokens || undefined,
  })
}

export async function getDefaultProvider(): Promise<AIProvider> {
  const row = await db.aIProvider.findFirst({ where: { isDefault: true } })
  if (row) return getProviderById(row.id)
  // Fall back to built-in ZAI provider (no key required, server-side only).
  return new ZAIProvider()
}

export function buildProvider(opts: {
  // Accept the full provider-kind catalog — bulk-import and the provider
  // manager create rows with ~40 different kinds; a narrow union made tsc
  // fail on every case label below even though the switch handles them.
  kind: string
  name: string
  endpoint?: string
  apiKey: string
  model: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
}): AIProvider {
  switch (opts.kind) {
    case 'openai':
      return new OpenAIProvider({ apiKey: opts.apiKey, model: opts.model, endpoint: opts.endpoint, displayName: opts.name })
    case 'gemini':
      return new GeminiProvider({ apiKey: opts.apiKey, model: opts.model, endpoint: opts.endpoint })
    case 'claude':
      return new ClaudeProvider({ apiKey: opts.apiKey, model: opts.model, endpoint: opts.endpoint })
    case 'groq':
      return new GroqProvider({ apiKey: opts.apiKey, model: opts.model })
    case 'openrouter':
    case 'openrouter-free':
      return new OpenRouterProvider({ apiKey: opts.apiKey, model: opts.model })
    // All the following providers are OpenAI-compatible APIs — they all
    // expose /v1/chat/completions with bearer auth, so we reuse the same
    // OpenAI-compatible adapter and just point the endpoint at their host.
    case 'mistral':
      return new OpenAICompatibleProvider({ apiKey: opts.apiKey, model: opts.model, endpoint: opts.endpoint || 'https://api.mistral.ai/v1', displayName: opts.name })
    case 'deepseek':
      return new OpenAICompatibleProvider({ apiKey: opts.apiKey, model: opts.model, endpoint: opts.endpoint || 'https://api.deepseek.com/v1', displayName: opts.name })
    case 'together':
    case 'together-free':
      return new OpenAICompatibleProvider({ apiKey: opts.apiKey, model: opts.model, endpoint: opts.endpoint || 'https://api.together.xyz/v1', displayName: opts.name })
    case 'fireworks':
    case 'fireworks-free':
      return new OpenAICompatibleProvider({ apiKey: opts.apiKey, model: opts.model, endpoint: opts.endpoint || 'https://api.fireworks.ai/inference/v1', displayName: opts.name })
    case 'perplexity':
      return new OpenAICompatibleProvider({ apiKey: opts.apiKey, model: opts.model, endpoint: opts.endpoint || 'https://api.perplexity.ai', displayName: opts.name })
    case 'cohere':
      return new OpenAICompatibleProvider({ apiKey: opts.apiKey, model: opts.model, endpoint: opts.endpoint || 'https://api.cohere.com/v1', displayName: opts.name })
    case 'ai21':
      return new OpenAICompatibleProvider({ apiKey: opts.apiKey, model: opts.model, endpoint: opts.endpoint || 'https://api.ai21.com/v1', displayName: opts.name })
    case 'novita':
      return new OpenAICompatibleProvider({ apiKey: opts.apiKey, model: opts.model, endpoint: opts.endpoint || 'https://api.novita.ai/v3/openai', displayName: opts.name })
    case 'nebius':
      return new OpenAICompatibleProvider({ apiKey: opts.apiKey, model: opts.model, endpoint: opts.endpoint || 'https://api.studio.nebius.ai/v1', displayName: opts.name })
    case 'cerebras':
      return new OpenAICompatibleProvider({ apiKey: opts.apiKey, model: opts.model, endpoint: opts.endpoint || 'https://api.cerebras.ai/v1', displayName: opts.name })
    case 'sambanova':
      return new OpenAICompatibleProvider({ apiKey: opts.apiKey, model: opts.model, endpoint: opts.endpoint || 'https://api.sambanova.ai/v1', displayName: opts.name })
    case 'xai':
      return new OpenAICompatibleProvider({ apiKey: opts.apiKey, model: opts.model, endpoint: opts.endpoint || 'https://api.x.ai/v1', displayName: opts.name })
    case 'huggingface':
      return new OpenAICompatibleProvider({ apiKey: opts.apiKey, model: opts.model, endpoint: opts.endpoint || 'https://api-inference.huggingface.co/v1', displayName: opts.name })
    case 'replicate':
      return new OpenAICompatibleProvider({ apiKey: opts.apiKey, model: opts.model, endpoint: opts.endpoint || 'https://api.replicate.com/v1', displayName: opts.name })
    case 'anyscale':
      return new OpenAICompatibleProvider({ apiKey: opts.apiKey, model: opts.model, endpoint: opts.endpoint || 'https://api.endpoints.anyscale.com/v1', displayName: opts.name })
    case 'lepton':
      return new OpenAICompatibleProvider({ apiKey: opts.apiKey, model: opts.model, endpoint: opts.endpoint || 'https://api.lepton.ai/v1', displayName: opts.name })
    case 'siliconflow':
      return new OpenAICompatibleProvider({ apiKey: opts.apiKey, model: opts.model, endpoint: opts.endpoint || 'https://api.siliconflow.cn/v1', displayName: opts.name })
    case 'openai-compatible':
      return new OpenAICompatibleProvider({ apiKey: opts.apiKey || 'no-key', model: opts.model, endpoint: opts.endpoint || 'http://localhost:11434/v1', displayName: opts.name })
    // All uncensored providers are OpenAI-compatible — they all expose
    // /v1/chat/completions with bearer auth.
    case 'venice':
      return new OpenAICompatibleProvider({ apiKey: opts.apiKey || 'no-key', model: opts.model, endpoint: opts.endpoint || 'https://api.venice.ai/api/v1', displayName: opts.name })
    case 'deepinfra':
      return new OpenAICompatibleProvider({ apiKey: opts.apiKey || 'no-key', model: opts.model, endpoint: opts.endpoint || 'https://api.deepinfra.com/v1/openai', displayName: opts.name })
    case 'openrouter-uncensored':
    case 'together-uncensored':
    case 'huggingface-uncensored':
    case 'ollama-local':
    case 'lmstudio-local':
    case 'vllm-local':
    case 'textgen-local':
    case 'koboldcpp-local':
    case 'jan-local':
    case 'faraday-local':
    case 'runpod-uncensored':
    case 'modal-uncensored':
    case 'replicate-uncensored':
    case 'glhf-uncensored':
    case 'featherless-uncensored':
    case 'helicone-uncensored':
    case 'openai-pipe-uncensored':
    case 'litellm-local':
    case 'petals-uncensored':
    case 'cloudflare-ai-uncensored':
      return new OpenAICompatibleProvider({ apiKey: opts.apiKey || 'no-key', model: opts.model, endpoint: opts.endpoint || 'http://localhost:11434/v1', displayName: opts.name })
    case 'custom':
      // Fully custom provider — use endpoint + apiKey + model as-is
      if (!opts.endpoint) {
        throw new Error('Custom provider requires an endpoint')
      }
      return new OpenAICompatibleProvider({ apiKey: opts.apiKey || 'no-key', model: opts.model, endpoint: opts.endpoint, displayName: opts.name || 'Custom' })
    case 'local':
      // v111 — auto-provisioned open-source model on this server (Ollama /
      // llama.cpp / vLLM). No API key exists or is needed; the endpoint
      // points at the local OpenAI-compatible /v1 surface.
      return new OpenAICompatibleProvider({ apiKey: 'local', model: opts.model, endpoint: opts.endpoint || `${LOCAL_AI_BASE}/v1`, displayName: opts.name })
    case 'zai':
    default:
      return new ZAIProvider(opts.model)
  }
}

export function parseToolCallsFromText(text: string): ChatMessage['tool_calls'] {
  const out: NonNullable<ChatMessage['tool_calls']> = []
  const re = /```(?:tool|tool_call|function)?\s*({[\s\S]*?})\s*```/g
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    try {
      const obj = JSON.parse(m[1])
      if (obj.name || obj.function?.name) {
        const name = obj.function?.name || obj.name
        const args = obj.function?.arguments || obj.arguments || {}
        out.push({
          id: `call_${Date.now()}_${i++}`,
          type: 'function',
          function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
        })
      }
    } catch {}
  }
  return out.length ? out : undefined
}
