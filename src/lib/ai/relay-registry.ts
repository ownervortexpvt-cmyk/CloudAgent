/**
 * Browser-direct LLM relay registry.
 *
 * Some providers (Groq, OpenAI, …) Cloudflare-block the SERVER's datacenter
 * IP — every API call returns 403 regardless of key validity. The user's
 * DEVICE is not blocked. During a swarm run, when a provider fails with a
 * region-block signature, the server parks the LLM request in this registry,
 * streams `{type:'llm_request', …}` to the browser, and the browser performs
 * the call from the device (exactly how the old APK's "Browser-direct mode"
 * worked) and POSTs the result to /api/multi-agent/relay, which resolves the
 * parked promise here.
 */

export interface RelayResolveValue {
  ok: boolean
  status?: number
  content?: string
  error?: string
  tokensIn?: number
  tokensOut?: number
  /** which side answered — for the feed */
  via?: string
}

interface PendingRelay {
  runId: string
  providerName: string
  resolve: (v: RelayResolveValue) => void
  timer: ReturnType<typeof setTimeout>
}

// ⚠️ Next.js compiles EACH route with its own copy of this module (dev mode
// especially). A plain module-level Map would give /api/multi-agent and
// /api/multi-agent/relay two DIFFERENT registries — the browser's relay
// answer would never resolve the parked run (verified in E2E). Storing the
// Map on globalThis guarantees every route in the process shares ONE map.
const g = globalThis as unknown as { __llmRelayPending?: Map<string, PendingRelay> }
const pending: Map<string, PendingRelay> = g.__llmRelayPending ?? new Map()
g.__llmRelayPending = pending

export function parkRelay(
  reqId: string,
  runId: string,
  providerName: string,
  timeoutMs: number,
): Promise<RelayResolveValue> {
  return new Promise<RelayResolveValue>((resolve) => {
    const timer = setTimeout(() => {
      if (pending.has(reqId)) {
        pending.delete(reqId)
        resolve({ ok: false, error: `device relay timed out after ${Math.round(timeoutMs / 1000)}s (is the app tab open?)` })
      }
    }, timeoutMs)
    pending.set(reqId, { runId, providerName, resolve, timer })
  })
}

/** Resolve a parked relay from the /api/multi-agent/relay endpoint. Returns false if unknown/expired. */
export function resolveRelay(reqId: string, value: RelayResolveValue): boolean {
  const p = pending.get(reqId)
  if (!p) return false
  clearTimeout(p.timer)
  pending.delete(reqId)
  p.resolve(value)
  return true
}

/** Reject every pending relay of a run (stop/finish cleanup). */
export function failRelaysOfRun(runId: string, error: string): number {
  let n = 0
  for (const [id, p] of Array.from(pending.entries())) {
    if (p.runId === runId) {
      clearTimeout(p.timer)
      pending.delete(id)
      p.resolve({ ok: false, error })
      n++
    }
  }
  return n
}
