/**
 * v166 — PERMANENT SPECIALIST AI LANES (owner order: "permanently 8 ta powerful AI
 * install kore vortex cloud agent e load koro — kokhonoi rate limit ashbena,
 * ultra powerful").
 *
 * Eight ALWAYS-LOADED specialist lanes — one per pipeline role:
 *   Planner · Designer · Developer · Database · Tester · Debugger · Security · DevOps
 *
 * Design contract:
 *   • PERMANENT — the pool is created once per server process at boot
 *     (instrumentation.ts → warmSpecialistLanes()) and lives for the
 *     process lifetime. No cold starts, no per-run construction.
 *   • POWERFUL — every lane runs `glm-5.3` (the strongest built-in model),
 *     and deep-reasoning roles get SDK `thinking: enabled` on plain chat
 *     turns (Planner, Designer, Debugger, Security review). Tool loops keep
 *     thinking off (v29: hidden CoT inside a multi-turn tool loop burns the
 *     600s turn cap — verified platform regression), so power lands exactly
 *     where it is safe.
 *   • RATE-LIMIT-PROOF — every lane is SINGLE-FLIGHT: calls for the same
 *     role queue behind each other (never burst the same lane), starts are
 *     additionally spaced by the global ZAI gate (~1s jitter), and the
 *     v165 backoff (2×30-60s) rides out upstream per-minute windows.
 *     Honest note: all lanes share ONE upstream quota family until the
 *     owner adds provider keys in Provider Manager — lanes then use those
 *     keys as fallbacks automatically.
 *   • OBSERVABLE — laneStatus() exposes per-lane stats (calls, retries,
 *     429 backoffs, last used) so the dashboard can prove "8 agents loaded".
 */
import { AIProvider, ChatMessage, ChatOptions, ChatResponse, ToolDef, ZAIProvider } from './providers'

export type SpecialistRole =
  | 'Planner' | 'Designer' | 'Developer' | 'Database'
  | 'Tester' | 'Debugger' | 'Security' | 'DevOps'

export const SPECIALIST_ROLES: SpecialistRole[] = [
  'Planner', 'Designer', 'Developer', 'Database',
  'Tester', 'Debugger', 'Security', 'DevOps',
]

/** Deep-reasoning lanes get SDK thinking on plain chat turns. */
const THINKING_LANES = new Set<SpecialistRole>(['Planner', 'Designer', 'Developer', 'Debugger', 'Security'])

export interface LaneStats {
  role: SpecialistRole
  model: string
  thinking: 'enabled' | 'disabled'
  calls: number
  busy: boolean
  queued: number
  throttledRetries: number
  errors: number
  lastUsedAt: number | null
  loadedAt: number
}

interface Lane {
  role: SpecialistRole
  provider: LaneProvider
  stats: LaneStats
}

/**
 * A queue-wrapped provider: same AIProvider contract, but every call for
 * this role (a) waits for the lane's previous call to finish (single-flight),
 * (b) bumps lane stats, (c) injects the lane's thinking preference on plain
 * chat/stream turns.
 */
export class LaneProvider implements AIProvider {
  readonly kind: string
  readonly displayName: string
  readonly model: string

  constructor(private lane: Lane) {
    this.kind = 'zai'
    this.model = lane.provider.model
    this.displayName = `Vortex ${lane.role} Agent — permanent (glm-5.3)`
  }

  supportsTools() { return true }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    const s = this.lane.stats
    const g = globalThis as any
    const key = `__caLaneQ_${this.lane.role}`
    const prev: Promise<void> = g[key] || Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    g[key] = prev.then(() => gate)
    s.queued++
    await prev
    s.busy = true
    s.calls++
    s.lastUsedAt = Date.now()
    try {
      return await fn()
    } catch (e: any) {
      if (/429|rate.*limit|quota/i.test(String(e?.message))) s.throttledRetries++
      else s.errors++
      throw e
    } finally {
      s.busy = false
      release()
    }
  }

  private withThinking(opts: ChatOptions = {}): ChatOptions {
    if (opts.thinking) return opts
    return THINKING_LANES.has(this.lane.role)
      ? { ...opts, thinking: 'enabled' }
      : opts
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResponse> {
    return this.run(() => this.lane.provider.chat(messages, this.withThinking(opts)))
  }

  async stream(messages: ChatMessage[], opts: ChatOptions & { onToken?: (t: string) => void } = {}): Promise<ChatResponse> {
    return this.run(() => this.lane.provider.stream(messages, this.withThinking(opts)))
  }

  async chatWithTools(messages: ChatMessage[], tools: ToolDef[], opts: ChatOptions = {}): Promise<ChatResponse> {
    // Tool loops keep thinking OFF (v29 regression guard) — the queue and
    // stats still apply, so bursts stay impossible on this lane.
    return this.run(() => this.lane.provider.chatWithTools(messages, tools, opts))
  }
}

const g = globalThis as any

function buildLane(role: SpecialistRole): Lane {
  const stats: LaneStats = {
    role,
    model: 'glm-5.3',
    thinking: THINKING_LANES.has(role) ? 'enabled' : 'disabled',
    calls: 0, busy: false, queued: 0, throttledRetries: 0, errors: 0,
    lastUsedAt: null,
    loadedAt: Date.now(),
  }
  // glm-5.3 = strongest built-in model (flash is the fast lane, not this).
  const lane: Lane = { role, provider: null as unknown as LaneProvider, stats }
  lane.provider = new LaneProvider({ role, provider: new ZAIProvider('glm-5.3', `Vortex ${role} Agent (permanent)`) as any, stats })
  return lane
}

/** Idempotent boot hook — call from instrumentation.ts. */
export function warmSpecialistLanes(): LaneStats[] {
  if (!g.__caSpecialistLanes) {
    g.__caSpecialistLanes = new Map<SpecialistRole, Lane>(
      SPECIALIST_ROLES.map((r) => [r, buildLane(r)]),
    )
    console.log(`[ai-lanes] 8 permanent specialist lanes loaded (glm-5.3, thinking: ${SPECIALIST_ROLES.filter((r) => THINKING_LANES.has(r)).join('/')})`)
  }
  return laneStatus()
}

export function getLane(role: SpecialistRole): LaneProvider {
  const lanes = warmSpecialistLanes()
  const lane = (g.__caSpecialistLanes as Map<SpecialistRole, Lane>).get(role)
  if (!lane) throw new Error(`unknown specialist lane: ${role}`)
  return lane.provider
}

export function laneStatus(): LaneStats[] {
  const m = g.__caSpecialistLanes as Map<SpecialistRole, Lane> | undefined
  if (!m) return warmSpecialistLanes()
  return [...m.values()].map((l) => ({ ...l.stats }))
}
