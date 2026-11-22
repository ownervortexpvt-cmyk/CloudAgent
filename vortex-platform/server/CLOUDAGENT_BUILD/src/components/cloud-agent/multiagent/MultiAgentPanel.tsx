'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  Network, Play, Square, Loader2, Users, FileCode2, Zap, AlertTriangle,
  CheckCircle2, XCircle, RefreshCw, Bot, BrainCircuit, Wrench, ShieldCheck,
  SearchCheck, Crown, KeyRound, Plus, Download, CalendarClock,
  Stethoscope, Timer, Wallet, Gauge,
} from 'lucide-react'
import { ScheduleDialog } from '@/components/cloud-agent/multiagent/ScheduleDialog'
import { estimateCostUSD } from '@/lib/pricing'
import { toast } from 'sonner'
import { useAppStore } from '@/lib/store'

interface TeamConfig {
  coordinatorCount: number
  qualityCheckerCount: number
  featureCheckerCount: number
  codeWriterCount: number
  setupAgentCount: number
  maxConcurrency: number
}

const PRESETS: Array<{ id: string; label: string; desc: string; cfg: Omit<TeamConfig, 'maxConcurrency'> }> = [
  {
    id: 'lite', label: '⚡ Lite — 12 agents', desc: '1 coordinator · 2 quality · 2 feature · 5 writers · 2 setup — quick tasks',
    cfg: { coordinatorCount: 1, qualityCheckerCount: 2, featureCheckerCount: 2, codeWriterCount: 5, setupAgentCount: 2 },
  },
  {
    id: 'squad', label: '🚀 Squad — 50 agents', desc: '1 · 5 · 5 · 35 · 4 — balanced team for a full feature',
    cfg: { coordinatorCount: 1, qualityCheckerCount: 5, featureCheckerCount: 5, codeWriterCount: 35, setupAgentCount: 4 },
  },
  {
    id: 'army', label: '🪖 Army — 1000 agents', desc: '1 · 10 · 15 · 970 · 4 — the full swarm. Thousands of AIs working together.',
    cfg: { coordinatorCount: 1, qualityCheckerCount: 10, featureCheckerCount: 15, codeWriterCount: 970, setupAgentCount: 4 },
  },
  {
    id: 'mega', label: '🌊 Mega — 5000 agents', desc: '2 · 40 · 60 · 4890 · 8 — maximum firepower for huge apps',
    cfg: { coordinatorCount: 2, qualityCheckerCount: 40, featureCheckerCount: 60, codeWriterCount: 4890, setupAgentCount: 8 },
  },
]

/**
 * AUTO MODE — keys = agents.
 * The user never types a number: add 10 keys → 10 agents work together,
 * add 50 keys → 50 agents, add 1000 keys → 1000 agents, ALL in parallel.
 * The leader is 1 coordinator; the rest split between checkers and writers.
 */
function distributeSwarm(total: number): Omit<TeamConfig, 'maxConcurrency'> {
  const t = Math.max(1, Math.min(10000, Math.floor(total) || 1))
  if (t <= 3) {
    return { coordinatorCount: 1, qualityCheckerCount: 0, featureCheckerCount: 0, codeWriterCount: Math.max(1, t - 1), setupAgentCount: 0 }
  }
  if (t <= 10) {
    return {
      coordinatorCount: 1,
      qualityCheckerCount: 1,
      featureCheckerCount: 1,
      codeWriterCount: Math.max(1, t - 3 - (t >= 6 ? 1 : 0)),
      setupAgentCount: t >= 6 ? 1 : 0,
    }
  }
  const coordinatorCount = 1
  const setupAgentCount = t >= 100 ? 4 : 2
  const qualityCheckerCount = Math.min(20, Math.max(1, Math.round(t * 0.02)))
  const featureCheckerCount = Math.min(20, Math.max(1, Math.round(t * 0.02)))
  const codeWriterCount = Math.max(1, t - coordinatorCount - setupAgentCount - qualityCheckerCount - featureCheckerCount)
  return { coordinatorCount, qualityCheckerCount, featureCheckerCount, codeWriterCount, setupAgentCount }
}

interface PoolProvider { id: string; name: string; kind: string; model: string; isDefault: boolean; role?: string; status?: string }
interface PoolInfo {
  poolSize: number
  byKind: Record<string, number>
  providers?: PoolProvider[]
  balancer: { healthy: number; cooldown: number; dead: number }
}

interface LogLine {
  id: number
  kind: 'info' | 'phase' | 'agent' | 'ok' | 'fail' | 'file' | 'switch' | 'summary'
  text: string
}

/** v57 — Live Agent Board: one entry per agent, updated from real events */
interface AgentBoardEntry {
  role: string
  task: string
  status: 'working' | 'switching' | 'done' | 'failed'
  files: number
  note?: string
  provider?: string
  model?: string
  durationMs?: number
  tokensOut?: number
  error?: string
  preview?: string
  lastAt: number
}

/** v59 — phase strip: the run's 6 phases, driven by real `phase` events */
const PHASES: Array<{ key: string; label: string }> = [
  { key: 'leader', label: '👑 Plan' },
  { key: 'setup', label: '📦 Setup' },
  { key: 'feature', label: '🔍 Feature audit' },
  { key: 'writers', label: '✍️ Writing' },
  { key: 'quality', label: '🛡️ Quality' },
  { key: 'coordinate', label: '🎯 Summary' },
]

const ROSTER_PREVIEW_LIMIT = 60

export function MultiAgentPanel({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { multiAgentOpen, setMultiAgentOpen, setProviderManagerOpen, providerManagerOpen, bumpTree, multiAgentPrompt, setMultiAgentPrompt } = useAppStore()

  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [preset, setPreset] = useState('squad')
  const [cfg, setCfg] = useState<TeamConfig>({ ...PRESETS[1].cfg, maxConcurrency: 8 })
  const [task, setTask] = useState('')
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [pool, setPool] = useState<PoolInfo | null>(null)
  const [poolLoading, setPoolLoading] = useState(false)
  const [leaderPlan, setLeaderPlan] = useState('')
  const [progress, setProgress] = useState({ done: 0, total: 0, files: 0, failed: 0 })
  const [summary, setSummary] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  // v57 — 🤖 Live Agent Board (kon AI kon kaj korse) + per-key scoreboard
  const [board, setBoard] = useState<Record<string, AgentBoardEntry>>({})
  const [keyStats, setKeyStats] = useState<Record<string, { ok: number; fail: number; totalMs: number; tokens: number }>>({})
  // v57 — connection truth: live | reconnecting | lost (banner in the header)
  const [connStatus, setConnStatus] = useState<'idle' | 'live' | 'reconnecting' | 'lost'>('idle')
  // v59 — live progress: team manifest, current phase, elapsed clock, pre-flight
  const [teamInfo, setTeamInfo] = useState<{ total: number; slots: number } | null>(null)
  const [phase, setPhase] = useState('')
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [nowTick, setNowTick] = useState(Date.now())
  const [preflight, setPreflight] = useState<{ busy: boolean; ready: number; total: number; failed: number; at: number } | null>(null)
  const [boardDetailId, setBoardDetailId] = useState<string | null>(null)

  const logIdRef = useRef(0)
  const logBoxRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  // v55 Unbreakable Army: how many stream events we've SEEN (rejoin cursor)
  const evIndexRef = useRef(0)
  // v57: wake the rejoin backoff early when the network comes back
  const wakeRef = useRef<(() => void) | null>(null)

  const keyCount = pool?.poolSize || 0
  const autoCfg = distributeSwarm(keyCount)
  const autoTotal = keyCount > 0
    ? autoCfg.coordinatorCount + autoCfg.qualityCheckerCount + autoCfg.featureCheckerCount + autoCfg.codeWriterCount + autoCfg.setupAgentCount
    : 0
  const activeCfg = mode === 'auto' ? autoCfg : cfg
  const totalAgents = activeCfg.coordinatorCount + activeCfg.qualityCheckerCount + activeCfg.featureCheckerCount + activeCfg.codeWriterCount + activeCfg.setupAgentCount
  // Auto mode: every agent runs at once (one per key). Manual: user slider.
  const effectiveConcurrency = mode === 'auto' ? Math.min(totalAgents || 1, 1000) : cfg.maxConcurrency

  async function loadPool() {
    setPoolLoading(true)
    try {
      const res = await fetch('/api/providers/health')
      setPool(await res.json())
    } catch {} finally { setPoolLoading(false) }
  }

  // Load provider pool info when the dialog opens — and refresh it when the
  // Provider Manager closes (the user may have added keys via Quick API Setup)
  useEffect(() => {
    if (!multiAgentOpen) return
    loadPool()
  }, [multiAgentOpen])

  useEffect(() => {
    if (multiAgentOpen && !providerManagerOpen) loadPool()
  }, [providerManagerOpen])

  // v58 — one-shot prompt preset ("Run again" from 🕘 history): fill the task
  // box and clear the preset so it never re-fires on later opens.
  useEffect(() => {
    if (!multiAgentOpen || !multiAgentPrompt) return
    setTask(multiAgentPrompt)
    setMultiAgentPrompt('')
  }, [multiAgentOpen, multiAgentPrompt])

  // v60 — task draft persistence: a long army task survives a refresh or an
  // accidental panel close. Restored once per project; saved on every edit.
  useEffect(() => {
    if (!multiAgentOpen) return
    try {
      const saved = localStorage.getItem(`ca:swarmdraft:${projectId}`)
      if (saved) setTask(t => (t ? t : saved))
    } catch {}
  }, [multiAgentOpen, projectId])
  useEffect(() => {
    try { localStorage.setItem(`ca:swarmdraft:${projectId}`, task) } catch {}
  }, [task, projectId])

  // Autoscroll the feed
  useEffect(() => {
    if (autoScroll && logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  function addLog(kind: LogLine['kind'], text: string) {
    setLogs(prev => {
      const next = [...prev, { id: ++logIdRef.current, kind, text }]
      // Cap the feed so a 5000-agent run doesn't melt the DOM
      return next.length > 800 ? next.slice(next.length - 800) : next
    })
  }

  function applyPreset(id: string) {
    const p = PRESETS.find(x => x.id === id)
    if (!p) return
    setPreset(id)
    setCfg({ ...p.cfg, maxConcurrency: cfg.maxConcurrency })
  }

  /** Roster entry for agent #i: which key it is bound to (same formula as backend) */
  function rosterKeyFor(i: number): PoolProvider | undefined {
    const list = pool?.providers || []
    if (list.length === 0) return undefined
    return list[i % list.length]
  }

  /** 👑 Leader roster positions — derived from the providers the user crowned
   *  (max 4) in Quick API Setup → Agents. Roster index i binds to pool key
   *  i % N, so an agent is a leader exactly when ITS key is crowned. */
  const leaderIndexes = (() => {
    const list = pool?.providers || []
    if (list.length === 0) return [0]
    const idx: number[] = []
    for (let i = 0; i < totalAgents && idx.length < 4; i++) {
      if (rosterKeyFor(i)?.role === 'leader') idx.push(i)
    }
    return idx.length > 0 ? idx : [0]
  })()
  const leaderCount = leaderIndexes.length

  /** Crown/uncrown a roster agent — persists on the provider row (max 4
   *  enforced server-side) so Quick API Setup → Agents stays in sync. */
  async function toggleRosterLeader(key: PoolProvider | undefined) {
    if (!key) return
    const nextRole = key.role === 'leader' ? 'work' : 'leader'
    try {
      const res = await fetch('/api/providers/role', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: key.id, role: nextRole }),
      })
      const data = await res.json().catch(() => ({} as any))
      if (!res.ok) { toast.error(data.error || 'Could not change the role'); return }
      toast.success(nextRole === 'leader' ? `👑 ${key.name} promoted to LEADER (${data.leaders}/4)` : `${key.name} is now a WORK agent`)
      loadPool()
    } catch (e: any) { toast.error(e.message) }
  }

  /** BROWSER-DIRECT relay: the server got region-blocked by the provider
   *  (Groq/OpenAI Cloudflare-block datacenter IPs) and asked THIS DEVICE to
   *  perform the LLM call. We fetch from here — the device is not blocked —
   *  and POST the answer back so the blocked agent continues. */
  async function answerRelay(ev: any) {
    const respond = (payload: Record<string, unknown>) =>
      fetch('/api/multi-agent/relay', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reqId: ev.reqId, ...payload }),
      }).catch(() => {})
    try {
      const res = await fetch(ev.request.url, {
        method: 'POST',
        headers: ev.request.headers,
        body: JSON.stringify(ev.request.body),
        signal: AbortSignal.timeout(110000),
      })
      const text = await res.text()
      if (!res.ok) {
        let msg = text.slice(0, 300)
        try { msg = JSON.parse(text)?.error?.message || msg } catch {}
        await respond({ ok: false, status: res.status, error: `HTTP ${res.status}: ${msg}` })
        return
      }
      const data = JSON.parse(text)
      let content = ''
      let tokensIn: number | undefined
      let tokensOut: number | undefined
      if (ev.request.style === 'claude') {
        content = (data.content || []).map((c: any) => c.text || '').join('')
        tokensIn = data.usage?.input_tokens
        tokensOut = data.usage?.output_tokens
      } else if (ev.request.style === 'gemini') {
        content = (data.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('')
        tokensIn = data.usageMetadata?.promptTokenCount
        tokensOut = data.usageMetadata?.candidatesTokenCount
      } else {
        content = data.choices?.[0]?.message?.content || ''
        tokensIn = data.usage?.prompt_tokens
        tokensOut = data.usage?.completion_tokens
      }
      await respond({ ok: true, content, tokensIn, tokensOut })
    } catch (e: any) {
      await respond({ ok: false, error: e?.message || 'device network error' })
    }
  }

  /* ── v55 Unbreakable Army — client rejoin ──────────────────────────────
   * The server keeps the swarm alive when the connection drops (or the tab
   * refreshes). These helpers process events in ONE place, remember how many
   * we've seen, and replay the gap from the server's run buffer. */

  function processSwarmEvent(ev: any): 'done' | 'continue' {
    // v57 — 🤖 Live Agent Board: every agent-identity event updates the board
    const markBoard = (id: string, patch: Partial<AgentBoardEntry> & { role?: string }) => {
      if (!id) return
      setBoard(prev => {
        const cur = prev[id] || { role: patch.role || 'agent', task: '', status: 'working' as const, files: 0, lastAt: Date.now() }
        return { ...prev, [id]: { ...cur, ...patch, lastAt: Date.now() } }
      })
    }
    const markKey = (provider: string | undefined, okDone: boolean, durationMs?: number, tokens?: number) => {
      if (!provider) return
      const name = provider.replace(/ \(via your device\)$/, '')
      setKeyStats(prev => {
        const cur = prev[name] || { ok: 0, fail: 0, totalMs: 0, tokens: 0 }
        return { ...prev, [name]: { ok: cur.ok + (okDone ? 1 : 0), fail: cur.fail + (okDone ? 0 : 1), totalMs: cur.totalMs + (durationMs || 0), tokens: cur.tokens + (tokens || 0) } }
      })
    }
    switch (ev.type) {
      case 'resumed':
        addLog('info', `🔌 Rejoined — replaying ${Math.max(0, (ev.total || 0) - (ev.from || 0))} missed event(s)${ev.done ? ' (run already finished)' : ''}`)
        setConnStatus('live')
        break
      case 'heartbeat':
        if (!ev.streamOnly) setConnStatus('live')
        break // liveness proof only
      case 'run_started':
        setRunId(ev.runId)
        setConnStatus('live')
        try { localStorage.setItem(`ca:swarmrun:${projectId}`, ev.runId) } catch {}
        break
      case 'status':
        addLog('info', ev.content)
        break
      case 'phase':
        addLog('phase', ev.content.trim())
        if (typeof ev.phase === 'string') setPhase(ev.phase)
        break
      case 'team':
        // v59 — machine-readable team manifest: drives progress %, ETA, phase strip
        setTeamInfo({ total: Number(ev.total) || 0, slots: Number(ev.slots) || 1 })
        setProgress(pr => ({ ...pr, total: Number(ev.total) || pr.total }))
        break
      case 'pool': {
        const dedupNote = ev.deduped > 0 ? ` (${ev.deduped} duplicate key(s) ignored — one key still does the work of ONE)` : ''
        addLog('info', `Provider pool: ${ev.total} key(s), ${ev.maxConcurrency} parallel slots${dedupNote}`)
        break
      }
      case 'agent_start':
        addLog('agent', `▶ ${ev.agentId} (${ev.role}) — ${ev.task || ''}`)
        markBoard(ev.agentId, { role: ev.role || 'agent', task: ev.task || '', status: 'working', error: undefined })
        break
      case 'agent_update':
        addLog('ok', `${ev.agentId}: ${ev.content}`)
        markBoard(ev.agentId, { role: ev.role, note: ev.content || undefined })
        break
      case 'files_written':
        for (const p of (ev.paths || [])) addLog('file', `📄 ${ev.agentId} wrote ${p}`)
        setBoard(prev => {
          const cur = prev[ev.agentId]
          if (!cur) return prev
          return { ...prev, [ev.agentId]: { ...cur, files: cur.files + (ev.count || 0), lastAt: Date.now() } }
        })
        setProgress(pr => ({ ...pr, files: pr.files + (ev.count || 0) }))
        bumpTree()
        break
      case 'provider_switch':
        addLog('switch', `🔄 ${ev.agentId}: ${ev.from} → next key (${ev.reason})`)
        markBoard(ev.agentId, { status: 'switching', note: `switching key: ${ev.reason || ''}` })
        break
      case 'llm_request':
        addLog('info', `⚡ ${ev.provider?.name || 'provider'} blocked the server — retrying from YOUR device…`)
        void answerRelay(ev)
        break
      case 'relay_ok':
        addLog('ok', `⚡ ${ev.agentId}: ${ev.provider} via YOUR DEVICE (${(ev.durationMs / 1000).toFixed(1)}s) — server block bypassed`)
        markBoard(ev.agentId, { provider: `${ev.provider} (via your device)` })
        break
      case 'relay_fail':
        addLog('fail', `⚡ device relay could not reach ${ev.provider}: ${ev.error || 'failed'}`)
        markBoard(ev.agentId, { note: `device relay failed: ${ev.error || 'failed'}` })
        break
      case 'agent_retry':
        addLog('switch', `🔁 ${ev.agentId}: ${ev.reason}`)
        markBoard(ev.agentId, { status: 'switching', note: `retrying: ${ev.reason || ''}` })
        break
      case 'leader_plan':
        setLeaderPlan(prev => (ev.leaderCount > 1 && ev.leaderNumber > 1
          ? `${prev}\n\n─── 👑 LEADER ${ev.leaderNumber} (${ev.agentId}) ───\n${ev.content || ''}`
          : (ev.leaderCount > 1 ? `─── 👑 LEADER 1 (${ev.agentId}) ───\n` : '') + (ev.content || '')))
        addLog('summary', `👑 Leader ${ev.leaderNumber ? `#${ev.leaderNumber} ` : ''}${ev.agentId} published the battle plan${ev.leaderCount > 1 ? ` (${ev.leaderNumber}/${ev.leaderCount})` : ''} — every writer receives it`)
        break
      case 'agent_result':
        if (ev.ok) {
          addLog('ok', `✓ ${ev.agentId} done via ${ev.provider}/${ev.model} (${(ev.durationMs / 1000).toFixed(1)}s)`)
          markBoard(ev.agentId, { role: ev.role, status: 'done', provider: ev.provider, model: ev.model, durationMs: ev.durationMs, tokensOut: ev.tokensOut, preview: typeof ev.preview === 'string' ? ev.preview : undefined, error: undefined })
          markKey(ev.provider, true, ev.durationMs, ev.tokensOut)
          setProgress(pr => ({ ...pr, done: pr.done + 1 }))
        } else {
          addLog('fail', `✗ ${ev.agentId} failed: ${ev.error || 'unknown'}`)
          markBoard(ev.agentId, { role: ev.role, status: 'failed', error: ev.error || 'unknown' })
          markKey(undefined, false)
          setProgress(pr => ({ ...pr, failed: pr.failed + 1, done: pr.done + 1 }))
        }
        break
      case 'batch':
        addLog('info', ev.content)
        break
      case 'batch_done':
        setProgress(pr => ({ ...pr, done: Math.max(pr.done, ev.completed || 0), files: ev.filesWritten ?? pr.files, failed: ev.failed ?? pr.failed }))
        break
      case 'coordinator_summary':
        setSummary(ev.content)
        addLog('summary', '🎯 Leader summary ready — see below')
        break
      case 'done':
        addLog(ev.ok ? 'ok' : 'fail', ev.content)
        setRunning(false)
        setRunId(null)
        setConnStatus('idle')
        try { localStorage.removeItem(`ca:swarmrun:${projectId}`) } catch {}
        // v60: notification center — every finished swarm run lands here
        try {
          useAppStore.getState().pushNotification({
            kind: 'swarm',
            ok: ev.ok !== false,
            title: ev.ok !== false ? 'Army run finished' : 'Army run failed',
            detail: String(ev.content || '').slice(0, 200),
          })
        } catch {}
        bumpTree()
        return 'done'
      case 'error':
        addLog('fail', `ERROR: ${ev.content}`)
        break
    }
    return 'continue'
  }

  /** Read one NDJSON response to the end. Returns true iff a `done` arrived.
   *  v57: 'resumed' and streamOnly heartbeats are NOT buffered server-side,
   *  so they must NOT advance the replay cursor (cursor drift bug — every
   *  reconnect used to make the next rejoin skip real events). */
  async function tailStream(res: Response): Promise<boolean> {
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let sawDone = false
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        let ev: any
        try { ev = JSON.parse(line) } catch { continue }
        if (ev.type !== 'resumed' && !ev.streamOnly) evIndexRef.current++
        if (processSwarmEvent(ev) === 'done') sawDone = true
      }
    }
    return sawDone
  }

  /** Rejoin a swarm run that is still going server-side (drop-safe).
   *  v57 — NEVER-GIVE-UP: up to 40 attempts with backoff capped at 15s
   *  (~7+ minutes of patience), the backoff is cut short the moment the
   *  device comes back online, the connection state is always visible in
   *  the header, and giving up NEVER deletes the run bookmark — the run
   *  may still be alive server-side, so a Reconnect button stays. */
  async function rejoinSwarm(id: string) {
    setRunning(true)
    setRunId(id)
    setConnStatus('reconnecting')
    const MAX_ATTEMPTS = 40
    let settled = false
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch('/api/multi-agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'rejoin', runId: id, from: evIndexRef.current }),
        })
        if (res.status === 404) {
          addLog('fail', 'This swarm run is no longer in memory (finished >15 min ago or the server restarted).')
          setConnStatus('idle')
          setRunning(false)
          setRunId(null)
          abortRef.current = null
          try { localStorage.removeItem(`ca:swarmrun:${projectId}`) } catch {}
          settled = true
          break
        }
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
        const sawDone = await tailStream(res)
        if (sawDone) { setConnStatus('idle'); setRunning(false); abortRef.current = null; settled = true; break }
        setConnStatus('reconnecting')
        addLog('info', `🔌 Connection dropped — rejoining in ${Math.round(Math.min(15000, 2000 * (attempt + 1)) / 1000)}s (your army KEEPS WORKING server-side)…`)
        await nap(Math.min(15000, 2000 * (attempt + 1)))
      } catch (e: any) {
        if (e?.name === 'AbortError') { setConnStatus('idle'); settled = true; break }
        setConnStatus('reconnecting')
        addLog('info', `🔌 Rejoin failed (${e?.message || e}) — retrying… (army keeps working server-side)`)
        await nap(Math.min(15000, 2000 * (attempt + 1)))
      }
    }
    // 40 attempts exhausted — the run may STILL be alive server-side: keep
    // the bookmark + show Reconnect instead of declaring death.
    if (!settled) setConnStatus('lost')
  }

  /** v57: sleep that wakes early when the device comes back online. */
  function nap(ms: number): Promise<void> {
    return new Promise(resolve => {
      const t = setTimeout(() => { wakeRef.current = null; resolve() }, ms)
      wakeRef.current = () => { clearTimeout(t); wakeRef.current = null; resolve() }
    })
  }

  // v57: the moment the network returns, cut the rejoin backoff short
  useEffect(() => {
    const onOnline = () => { wakeRef.current?.() }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  // v59 — 1s heartbeat for the elapsed clock + ETA while a run is live
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])

  /** v59 — 🩺 Pre-flight key check: BEFORE launching, give every saved key
   *  one real tiny chat call (/api/providers/test-all) so the owner knows
   *  exactly which keys will work — "kon key kaj korse" answered up front. */
  async function preflightCheck() {
    if (preflight?.busy) return
    setPreflight({ busy: true, ready: 0, total: 0, failed: 0, at: 0 })
    try {
      const res = await fetch('/api/providers/test-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) {
        toast.error(data?.error || 'Pre-flight check failed')
        setPreflight(null)
        return
      }
      const ready = Number(data.okCount) || 0
      const total = Number(data.total) || 0
      setPreflight({ busy: false, ready, total, failed: Math.max(0, total - ready), at: Date.now() })
      if (total === 0) toast.info('No keys saved yet — the run will use the built-in Vortex Engine provider')
      else if (ready === total) toast.success(`🩺 All ${total} key(s) ready — launch whenever you want`)
      else toast.warning(`🩺 ${ready}/${total} keys ready · ${total - ready} failed (they will be skipped/fail over during the run)`)
      loadPool()
    } catch (e: any) {
      toast.error(e?.message || 'Pre-flight check failed')
      setPreflight(null)
    }
  }

  /** v56 — ⬇ Export this run as a Markdown report: what was asked, which
   *  army built it, the live timeline and the Leader's final summary.
   *  Works mid-run AND after a rejoin (the feed holds everything the user
   *  actually saw). Pure client-side — the data is already on screen. */
  function exportReport() {
    if (logs.length === 0 && !summary && !task.trim()) {
      toast.error('Nothing to export yet — start a run first')
      return
    }
    const stamp = new Date()
    const kindTag: Record<LogLine['kind'], string> = {
      info: 'ℹ️', phase: '🧭', agent: '🤖', ok: '✅', fail: '❌', file: '📝', switch: '🔀', summary: '📊',
    }
    const lines: string[] = [
      `# Swarm Run Report`,
      ``,
      `- **Project:** ${projectName} (id: ${projectId})`,
      `- **Run ID:** ${runId || '(not started / lost)'}`,
      `- **Date:** ${stamp.toLocaleString()}`,
      `- **Mode:** ${mode === 'auto' ? `Keys = Agents (auto) — ${autoTotal} agents from ${keyCount} keys` : `Manual preset "${preset}" — ${totalAgents} agents`}`,
      `- **Concurrency:** ${effectiveConcurrency}`,
      `- **Progress:** ${progress.done}/${progress.total} tasks · ${progress.files} files written · ${progress.failed} failed`,
      ``,
      `## Task`,
      ``,
      task.trim() || '(task text not captured — page was refreshed before export)',
      ``,
    ]
    if (leaderPlan.trim()) {
      lines.push(`## Leader's Battle Plan`, ``, leaderPlan.trim(), ``)
    }
    lines.push(`## Timeline (${logs.length} events)`, ``)
    for (const l of logs) {
      lines.push(`- ${kindTag[l.kind] || '·'} ${l.text.replace(/\n+/g, ' ').slice(0, 400)}`)
    }
    if (summary.trim()) {
      lines.push(``, `## Leader Summary`, ``, summary.trim(), ``)
    }
    lines.push(``, `---`, ``, `Generated by AI Multi-Agent Swarm — ${stamp.toISOString()}`)
    const md = lines.join('\n')
    try {
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const safeName = (projectName || 'project').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40)
      a.href = url
      a.download = `swarm-report-${safeName}-${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(stamp.getDate()).padStart(2, '0')}-${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}.md`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('Report downloaded — open it with any Markdown viewer')
    } catch (e: any) {
      toast.error(e?.message || 'Could not download the report')
    }
  }

  // Mount: if the tab was refreshed mid-swarm, reconnect automatically
  useEffect(() => {
    if (!multiAgentOpen) return
    let saved: string | null = null
    try { saved = localStorage.getItem(`ca:swarmrun:${projectId}`) } catch {}
    if (saved) {
      addLog('info', `🔎 A swarm run may still be going (${saved}) — reconnecting…`)
      evIndexRef.current = 0
      void rejoinSwarm(saved)
    }
  }, [multiAgentOpen])

  async function start() {
    if (!task.trim()) return toast.error('Describe what to build first')
    if (running) return
    if (mode === 'auto' && keyCount === 0) {
      // No keys — the backend falls back to the built-in Vortex Engine provider
      toast.info('No keys in the pool — running on the built-in Vortex Engine provider')
    }
    setRunning(true)
    setLogs([])
    setSummary('')
    setLeaderPlan('')
    setProgress({ done: 0, total: totalAgents, files: 0, failed: 0 })
    setBoard({})
    setKeyStats({})
    setConnStatus('live')
    // v59 — fresh progress state for the new run
    setTeamInfo(null)
    setPhase('')
    setRunStartedAt(Date.now())
    setNowTick(Date.now())
    addLog('info', mode === 'auto'
      ? `Launching ${totalAgents} agents — ${keyCount} keys, each agent on its own key, ALL running in parallel…`
      : `Launching ${totalAgents} agents with ${effectiveConcurrency} parallel slots…`)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      // v67 GATEWAY-RETRY: same contract as AgentPanel — a proxy 502/503/504
      // (or a throw before headers) means the swarm NEVER STARTED, so a
      // short retry is safe and turns "Stream error: HTTP 502" into a
      // self-healing launch.
      const RETRIES = 3
      let res: Response | null = null
      let lastErr: any = null
      for (let attempt = 1; attempt <= RETRIES; attempt++) {
        try {
          const r = await fetch('/api/multi-agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId,
              task,
              config: { ...activeCfg, maxConcurrency: effectiveConcurrency, leaderIndexes },
            }),
            signal: ctrl.signal,
          })
          if (r.status === 502 || r.status === 503 || r.status === 504) {
            lastErr = new Error(`HTTP ${r.status}`)
            if (attempt < RETRIES) {
              addLog('info', `⏳ Gateway hiccup (HTTP ${r.status}) — retrying ${attempt + 1}/${RETRIES}…`)
              await new Promise(rr => setTimeout(rr, 900 * attempt))
              continue
            }
          }
          res = r
          break
        } catch (e2: any) {
          if (e2.name === 'AbortError') throw e2
          lastErr = e2
          if (attempt < RETRIES) {
            addLog('info', `⏳ Network hiccup (${e2.message || 'connection failed'}) — retrying ${attempt + 1}/${RETRIES}…`)
            await new Promise(rr => setTimeout(rr, 900 * attempt))
            continue
          }
        }
      }
      if (!res) throw lastErr || new Error('network error')

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }

      // v55: one reader for both the fresh stream AND any rejoin replays —
      // the event cursor (evIndexRef) makes the replay gap-free
      evIndexRef.current = 0
      const sawDone = await tailStream(res)

      // v55 Unbreakable Army: if the connection died before `done`, the run
      // is STILL going server-side — rejoin instead of dying with it
      if (!sawDone && !ctrl.signal.aborted) {
        const id = runId || (typeof window !== 'undefined' ? localStorage.getItem(`ca:swarmrun:${projectId}`) : null)
        if (id) {
          addLog('info', '🔌 Connection dropped — but the swarm keeps running. Rejoining…')
          await rejoinSwarm(id)
          return
        }
        addLog('fail', 'Stream ended without a final summary (connection lost, run too old to rejoin).')
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') addLog('fail', `Stream error: ${e.message}`)
    } finally {
      if (!(abortRef.current?.signal.aborted)) {
        setRunning(false)
        setRunId(null)
      }
      abortRef.current = null
    }
  }

  async function stop() {
    try {
      await fetch('/api/multi-agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop', runId }),
      })
      addLog('fail', '⏹ Stop requested — waiting for in-flight agents to cancel…')
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const poolBadge = pool
    ? `${pool.poolSize} AI key${pool.poolSize !== 1 ? 's' : ''} in pool`
    : '…'

  /* ── v59 — live progress math (ALL of it real data) ───────────────────
   * percent: processed agents / team total · elapsed: real clock since the
   * owner pressed Launch (hidden after a page refresh — honest) · ETA:
   * average ACTUAL duration of this run's successful agents × remaining
   * agents ÷ parallel slots · cost: real tokensOut × public list prices. */
  const donePct = progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0
  const elapsedMs = runStartedAt ? Math.max(0, nowTick - runStartedAt) : null
  const okStats = Object.values(keyStats).reduce((acc, s) => ({ ok: acc.ok + s.ok, ms: acc.ms + s.totalMs }), { ok: 0, ms: 0 })
  const avgAgentMs = okStats.ok > 0 ? okStats.ms / okStats.ok : 0
  const remaining = Math.max(0, progress.total - progress.done)
  const etaMs = avgAgentMs > 0 && remaining > 0 ? (avgAgentMs * remaining) / Math.max(1, teamInfo?.slots || effectiveConcurrency) : 0
  const fmtDur = (ms: number) => {
    const s = Math.round(ms / 1000)
    return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`
  }
  const costUsd = Object.entries(keyStats).reduce((sum, [name, s]) => sum + estimateCostUSD(name, 0, s.tokens), 0)

  const progressPanel = (
    <Card className="p-3 bg-muted/20 border-border">
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={donePct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-primary transition-all duration-500" style={{ width: `${donePct}%` }} />
      </div>
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-2 text-[10px] text-muted-foreground">
        <span className="font-semibold text-foreground">{donePct}%</span>
        <span className="flex items-center gap-1"><Gauge className="w-3 h-3" />{progress.done}/{progress.total || '?'} agents</span>
        {elapsedMs !== null && (
          <span className="flex items-center gap-1"><Timer className="w-3 h-3" />elapsed {fmtDur(elapsedMs)}</span>
        )}
        {etaMs > 0 && donePct < 100 && (
          <span className="flex items-center gap-1"><Timer className="w-3 h-3" />ETA ~{fmtDur(etaMs)}</span>
        )}
        {costUsd > 0 && (
          <span className="flex items-center gap-1" title="Real tokens so far × public list prices — rough estimate, not an invoice">
            <Wallet className="w-3 h-3" />≈ ${costUsd < 0.01 ? costUsd.toFixed(4) : costUsd.toFixed(2)} spent (rough)
          </span>
        )}
      </div>
      {/* phase strip — current phase highlighted, zero-agent phases dimmed */}
      <div className="flex items-center gap-1 flex-wrap mt-2">
        {PHASES.map(p => {
          const isCurrent = phase === p.key
          const skipped =
            (p.key === 'leader' && leaderCount === 0) ||
            (p.key === 'setup' && activeCfg.setupAgentCount === 0) ||
            (p.key === 'feature' && activeCfg.featureCheckerCount === 0) ||
            (p.key === 'quality' && activeCfg.qualityCheckerCount === 0)
          return (
            <span
              key={p.key}
              className={`px-1.5 py-0.5 rounded text-[9px] border ${
                isCurrent ? 'bg-primary/15 border-primary/40 text-primary font-semibold' :
                skipped ? 'border-border/40 text-muted-foreground/40 line-through' :
                'border-border text-muted-foreground'
              }`}
            >
              {p.label}
            </span>
          )
        })}
      </div>
    </Card>
  )

  // v57 — 🤖 Live Agent Board + 📊 Key Scoreboard (rendered mid-run and after)
  const ROLE_EMOJI: Record<string, string> = {
    leader: '👑', coordinator: '🎯', setup: '📦', feature: '🔍', quality: '🛡️', writer: '✍️',
  }
  const boardEntries = Object.entries(board).sort((a, b) => {
    const rank = (s: AgentBoardEntry['status']) => (s === 'working' ? 0 : s === 'switching' ? 1 : s === 'failed' ? 2 : 3)
    return rank(a[1].status) - rank(b[1].status) || a[0].localeCompare(b[0], undefined, { numeric: true })
  })
  const workingCount = boardEntries.filter(([, e]) => e.status === 'working' || e.status === 'switching').length
  const doneCount = boardEntries.filter(([, e]) => e.status === 'done').length
  const failedCount = boardEntries.filter(([, e]) => e.status === 'failed').length
  const keyStatRows = Object.entries(keyStats).sort((a, b) => b[1].ok - a[1].ok)
  const agentBoard = (boardEntries.length > 0 || keyStatRows.length > 0) ? (
    <Card className="p-3 bg-muted/20 border-border">
      <div className="flex items-center gap-2 mb-2">
        <Bot className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">Agent Board — who is doing what</span>
        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground">
          {workingCount > 0 && <>{workingCount} working · </>}{doneCount} done{failedCount > 0 ? ` · ${failedCount} failed` : ''}
        </span>
      </div>
      {boardEntries.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-2">
          {boardEntries.slice(0, 60).map(([id, e]) => (
            <button
              key={id}
              type="button"
              onClick={() => setBoardDetailId(id)}
              title="Tap for this agent's full details"
              className={`text-left rounded-md border px-2 py-1.5 text-[11px] cursor-pointer transition hover:border-primary/50 ${
                e.status === 'working' ? 'bg-primary/5 border-primary/30' :
                e.status === 'switching' ? 'bg-amber-500/5 border-amber-500/30' :
                e.status === 'done' ? 'bg-emerald-500/5 border-emerald-500/30' :
                'bg-red-500/5 border-red-500/30'
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="shrink-0">{ROLE_EMOJI[e.role] || '🤖'}</span>
                <span className="font-medium truncate">{id}</span>
                <span className="ml-auto shrink-0">
                  {e.status === 'working' ? (e.files > 0 ? `✍️ ${e.files} file${e.files !== 1 ? 's' : ''}` : '⏳ working') :
                  e.status === 'switching' ? '🔁 switching key' :
                  e.status === 'done' ? '✅ done' : '❌ failed'}
                </span>
              </div>
              {(e.task || e.note) && (
                <div className="text-[10px] text-muted-foreground truncate mt-0.5">{e.note || e.task}</div>
              )}
              {e.status === 'done' && (e.provider || e.durationMs !== undefined) && (
                <div className="text-[10px] text-emerald-600 dark:text-emerald-400 truncate mt-0.5">
                  {e.provider || ''}{e.model ? ` · ${e.model}` : ''}{e.durationMs ? ` · ${(e.durationMs / 1000).toFixed(1)}s` : ''}{e.tokensOut ? ` · ${e.tokensOut} out` : ''}
                </div>
              )}
              {e.status === 'failed' && e.error && (
                <div className="text-[10px] text-red-600 dark:text-red-400 truncate mt-0.5" title={e.error}>{e.error}</div>
              )}
            </button>
          ))}
          {boardEntries.length > 60 && (
            <div className="text-[10px] text-muted-foreground col-span-full">+{boardEntries.length - 60} more agents…</div>
          )}
        </div>
      )}
      {keyStatRows.length > 0 && (
        <div className="rounded-md border border-border overflow-hidden">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/40">Key scoreboard — this run</div>
          <div className="max-h-28 overflow-y-auto">
            {keyStatRows.map(([name, s]) => (
              <div key={name} className="flex items-center gap-2 px-2 py-1 text-[11px] border-t border-border first:border-t-0">
                <span className="font-medium truncate min-w-0 flex-1">{name}</span>
                <span className="text-emerald-600 dark:text-emerald-400 shrink-0">✅ {s.ok}</span>
                {s.fail > 0 && <span className="text-red-500 shrink-0">❌ {s.fail}</span>}
                {s.tokens > 0 && <span className="text-muted-foreground shrink-0">{s.tokens} tok</span>}
                {s.totalMs > 0 && s.ok > 0 && <span className="text-muted-foreground shrink-0">{(s.totalMs / s.ok / 1000).toFixed(1)}s avg</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  ) : null

  return (
    <Dialog open={multiAgentOpen} onOpenChange={(b) => { if (!running) setMultiAgentOpen(b) }}>
      <DialogContent className="w-[calc(100%-1rem)] sm:max-w-4xl max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="w-5 h-5 text-primary" />
            AI Army — Multi-Agent Swarm
          </DialogTitle>
          <DialogDescription>
            Launch a swarm of AI agents that build your project together. Every agent is bound to its own
            key and automatically rotates through ALL your keys — when one hits a rate limit or 401, the
            agent instantly switches to the next healthy key.
          </DialogDescription>
        </DialogHeader>

        {/* Provider pool status */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">
            <Bot className="w-3 h-3 mr-1" />{poolBadge}
          </Badge>
          {pool && pool.balancer && (
            <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
              <CheckCircle2 className="w-3 h-3 mr-1" />{pool.balancer.healthy} healthy
            </Badge>
          )}
          {connStatus !== 'idle' && (
            connStatus === 'live' ? (
              <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-500 border-emerald-500/30" title="Live event stream connected">
                🟢 Live
              </Badge>
            ) : connStatus === 'reconnecting' ? (
              <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-500 border-amber-500/30 animate-pulse" title="Your network dropped — reconnecting. The run CONTINUES on the server regardless.">
                🟡 Reconnecting — army keeps working
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-500 border-red-500/30" title="Lost the stream, but the run may still be alive server-side">
                🔴 Connection lost — run may still be going
              </Badge>
            )
          )}
          {pool && Object.entries(pool.byKind || {}).slice(0, 5).map(([k, n]) => (
            <Badge key={k} variant="outline" className="text-[10px]">{k} ×{n}</Badge>
          ))}
          <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setScheduleOpen(true)} title="Schedule runs — the army fires itself on a timer">
            <CalendarClock className="w-3 h-3 mr-0.5" />Schedule
          </Button>
          {!running && (
            <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => void preflightCheck()} disabled={preflight?.busy === true} title="Test every saved key with one real tiny call BEFORE launching — kon key kaj korse, launch er agei jane nin">
              {preflight?.busy ? <Loader2 className="w-3 h-3 mr-0.5 animate-spin" /> : <Stethoscope className="w-3 h-3 mr-0.5" />}
              {preflight?.busy ? 'Checking…' : 'Check keys'}
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setProviderManagerOpen(true)} title="Quick API Setup — paste keys, auto-detected">
            <Plus className="w-3 h-3 mr-0.5" />Keys
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={loadPool} title="Refresh pool">
            {poolLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          </Button>
        </div>

        {/* v57 — key health: kon AI kaj korse, kon korsena (balancer truth) */}
        {pool?.providers && pool.providers.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">Key health:</span>
            {pool.providers.slice(0, 14).map(p => (
              <Badge
                key={p.id}
                variant="outline"
                className="text-[10px] gap-1"
                title={`${p.name} · ${p.model} · role: ${p.role || 'work'} · balancer: ${p.status || 'healthy'}`}
              >
                {p.role === 'leader' ? '👑' : '🔧'} {p.name}{p.status === 'cooldown' ? ' · ⏳ cooldown' : p.status === 'dead' ? ' · 💀 dead' : p.status === 'disabled' ? ' · ⛔ off' : ''}
              </Badge>
            ))}
            {pool.providers.length > 14 && <span className="text-[10px] text-muted-foreground">+{pool.providers.length - 14} more</span>}
          </div>
        )}

        {/* v59 — 🩺 pre-flight verdict banner (real test-all result) */}
        {preflight && !preflight.busy && (
          <div
            className={`rounded-md border px-2.5 py-1.5 text-[11px] flex items-center gap-1.5 ${
              preflight.total === 0 ? 'bg-muted/30 border-border text-muted-foreground' :
              preflight.failed === 0 ? 'bg-emerald-500/5 border-emerald-500/30 text-emerald-600 dark:text-emerald-400' :
              'bg-amber-500/5 border-amber-500/30 text-amber-600 dark:text-amber-400'
            }`}
          >
            <Stethoscope className="w-3.5 h-3.5 shrink-0" />
            {preflight.total === 0
              ? 'No keys saved yet — the army will run on the built-in Vortex Engine provider'
              : <span>Pre-flight: <strong>{preflight.ready}/{preflight.total}</strong> key(s) ready{preflight.failed > 0 ? ` · ${preflight.failed} failed (agents auto-fail-over to healthy keys)` : ''} · checked {new Date(preflight.at).toLocaleTimeString()}</span>}
          </div>
        )}

        {!running ? (
          <>
            {/* v57 — Agent Board stays visible after a finished run (until New run) */}
            {agentBoard}

            {/* Task */}
            <div>
              <Label htmlFor="ma-task">What should the army build? (in {projectName})</Label>
              <Input
                id="ma-task"
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="e.g. Build a complete e-commerce app with cart, checkout and admin panel"
                className="mt-1"
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); start() } }}
              />
            </div>

            {/* Mode switch */}
            <Card className="p-3 bg-primary/5 border-primary/30">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold flex items-center gap-1.5">
                    <KeyRound className="w-4 h-4 text-primary" /> Keys = Agents
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    You never type a number. 10 keys → 10 agents work together · 50 keys → 50 agents ·
                    1000 keys → 1000 agents, all at the same time. Duplicated keys are ignored automatically
                    (one key still does the work of ONE).
                  </p>
                </div>
                <Switch checked={mode === 'auto'} onCheckedChange={(b) => setMode(b ? 'auto' : 'manual')} />
              </div>

              {mode === 'auto' && (
                <div className="mt-3 space-y-2">
                  {keyCount === 0 ? (
                    <div className="space-y-2">
                      <div className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        No keys yet — add API keys and each one becomes a working agent.
                      </div>
                      <Button size="sm" className="w-full" onClick={() => setProviderManagerOpen(true)}>
                        <Zap className="w-3.5 h-3.5 mr-1.5" />Quick API Setup — paste key(s) &amp; auto-detect
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        <Badge variant="outline" className="bg-accent/10 text-accent border-accent/30">
                          <Users className="w-3 h-3 mr-1" />{keyCount} keys → {totalAgents} agents
                        </Badge>
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
                          <Zap className="w-3 h-3 mr-1" />All {Math.min(totalAgents, 1000)} run in parallel
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-[10px] text-muted-foreground">
                        <span>👑 Leader: {autoCfg.coordinatorCount}</span>
                        <span>🛡️ Quality: {autoCfg.qualityCheckerCount}</span>
                        <span>🔍 Feature: {autoCfg.featureCheckerCount}</span>
                        <span>✍️ Writers: {autoCfg.codeWriterCount}</span>
                        <span>🔧 Setup: {autoCfg.setupAgentCount}</span>
                      </div>

                      {/* Roster preview with leader picker (max 4 leaders) */}
                      <div>
                        <Label className="text-[10px] flex items-center gap-1">
                          <Crown className="w-3 h-3 text-amber-500" />Team roster — tap 🤖 to crown a LEADER ({leaderCount}/4 · set in Quick API Setup → Agents)
                        </Label>
                        <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border divide-y divide-border/60">
                          {Array.from({ length: Math.min(autoTotal, ROSTER_PREVIEW_LIMIT) }, (_, i) => {
                            const key = rosterKeyFor(i)
                            const isLeader = leaderIndexes.includes(i)
                            const role = i < autoCfg.coordinatorCount ? 'leader/coordinator'
                              : i < autoCfg.coordinatorCount + autoCfg.qualityCheckerCount ? 'quality checker'
                              : i < autoCfg.coordinatorCount + autoCfg.qualityCheckerCount + autoCfg.featureCheckerCount ? 'feature checker'
                              : i < autoCfg.coordinatorCount + autoCfg.qualityCheckerCount + autoCfg.featureCheckerCount + autoCfg.codeWriterCount ? 'code writer'
                              : 'setup agent'
                            return (
                              <button
                                key={i}
                                type="button"
                                onClick={() => toggleRosterLeader(key)}
                                className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px] transition ${isLeader ? 'bg-amber-500/10' : 'hover:bg-muted/40'}`}
                              >
                                <span className="font-mono text-muted-foreground w-8 shrink-0">#{i + 1}</span>
                                {isLeader
                                  ? <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                  : <Bot className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                                <span className="flex-1 truncate">{key ? key.name : 'Vortex Engine (built-in)'}</span>
                                <span className="text-muted-foreground truncate hidden sm:inline">{role}</span>
                                {isLeader && <Badge variant="outline" className="text-[9px] py-0 border-amber-500/40 text-amber-500">LEADER</Badge>}
                              </button>
                            )
                          })}
                          {autoTotal > ROSTER_PREVIEW_LIMIT && (
                            <div className="px-2 py-1.5 text-[10px] text-muted-foreground">
                              … and {autoTotal - ROSTER_PREVIEW_LIMIT} more agents (leader selection covers the first {ROSTER_PREVIEW_LIMIT})
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </Card>

            {mode === 'manual' && (
              <>
                {/* Presets */}
                <div>
                  <Label>Team size preset</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                    {PRESETS.map(p => (
                      <Card
                        key={p.id}
                        className={`p-2.5 cursor-pointer transition border ${preset === p.id ? 'border-primary bg-primary/10' : 'hover:border-primary/40'}`}
                        onClick={() => applyPreset(p.id)}
                      >
                        <div className="text-xs font-semibold">{p.label}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{p.desc}</div>
                      </Card>
                    ))}
                  </div>
                </div>

                {/* Custom team config */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {([
                    ['coordinatorCount', 'Coordinators', Crown],
                    ['qualityCheckerCount', 'Quality Checkers', ShieldCheck],
                    ['featureCheckerCount', 'Feature Checkers', SearchCheck],
                    ['codeWriterCount', 'Code Writers', FileCode2],
                    ['setupAgentCount', 'Setup Agents', Wrench],
                  ] as const).map(([key, label, Icon]) => (
                    <div key={key}>
                      <Label className="text-[10px] flex items-center gap-1"><Icon className="w-3 h-3" />{label}</Label>
                      <Input
                        type="number"
                        min={0}
                        value={cfg[key]}
                        onChange={(e) => {
                          const v = Math.max(0, parseInt(e.target.value || '0', 10) || 0)
                          setCfg(c => ({ ...c, [key]: v }))
                          setPreset('custom')
                        }}
                        className="h-8 text-xs mt-1"
                      />
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <Badge variant="outline" className="text-xs bg-accent/10 text-accent border-accent/30">
                    <Users className="w-3 h-3 mr-1" />Total: {totalAgents} agents
                  </Badge>
                  <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                    <Label className="text-[10px] shrink-0 flex items-center gap-1"><Zap className="w-3 h-3" />Parallel: {cfg.maxConcurrency}</Label>
                    <Slider
                      value={[Math.min(cfg.maxConcurrency, 1000)]}
                      min={1}
                      max={1000}
                      step={1}
                      onValueChange={([v]) => setCfg(c => ({ ...c, maxConcurrency: v }))}
                    />
                  </div>
                </div>
              </>
            )}

            <div className="flex justify-end gap-2">
              <Button onClick={start} disabled={!task.trim()}>
                <Play className="w-4 h-4 mr-1.5" />
                {mode === 'auto' ? `Launch ${totalAgents || ''} Agents` : 'Launch Army'}
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* v59 — live progress bar: %, elapsed, ETA, cost, phase strip */}
            {progressPanel}

            {/* Live progress */}
            <div className="grid grid-cols-4 gap-2">
              <StatCard icon={CheckCircle2} label="Completed" value={progress.done} tone="text-emerald-500" />
              <StatCard icon={XCircle} label="Failed" value={progress.failed} tone="text-red-500" />
              <StatCard icon={FileCode2} label="Files written" value={progress.files} tone="text-primary" />
              <StatCard icon={Users} label="Total agents" value={progress.total} tone="text-accent" />
            </div>

            {/* v57 — 🤖 Agent Board: kon AI kon kaj korse, live */}
            {agentBoard}

            <div
              ref={logBoxRef}
              className="h-72 overflow-y-auto rounded-md border border-border bg-muted/20 p-2 font-mono text-[11px] leading-relaxed"
              onScroll={(e) => {
                const el = e.currentTarget
                setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
              }}
            >
              {logs.map(l => (
                <div
                  key={l.id}
                  className={
                    l.kind === 'phase' ? 'text-accent font-bold mt-1' :
                    l.kind === 'ok' ? 'text-emerald-500' :
                    l.kind === 'fail' ? 'text-red-500' :
                    l.kind === 'file' ? 'text-sky-400' :
                    l.kind === 'switch' ? 'text-amber-500' :
                    l.kind === 'summary' ? 'text-primary font-bold' :
                    l.kind === 'agent' ? 'text-muted-foreground' :
                    'text-foreground/80'
                  }
                >
                  {l.text}
                </div>
              ))}
              {running && (
                <div className="flex items-center gap-1.5 text-muted-foreground mt-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> swarm running…
                </div>
              )}
            </div>

            <div className="flex justify-between items-center">
              <div className="text-[10px] text-muted-foreground">
                {runId ? `run: ${runId}` : 'starting…'} · feed auto-scrolls (scroll up to pause)
              </div>
              <div className="flex items-center gap-1.5">
                {connStatus === 'lost' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      let id = runId
                      if (!id) { try { id = localStorage.getItem(`ca:swarmrun:${projectId}`) } catch {} }
                      if (id) void rejoinSwarm(id)
                      else toast.error('No run bookmark found — the run is gone from memory')
                    }}
                    title="The stream is lost but the run may still be alive server-side — reconnect to watch it"
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-1" />Reconnect
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={exportReport} title="Download this run's timeline + summary as a Markdown report">
                  <Download className="w-3.5 h-3.5 mr-1" />Report
                </Button>
                <Button variant="destructive" size="sm" onClick={stop}>
                  <Square className="w-3.5 h-3.5 mr-1" />Stop Army
                </Button>
              </div>
            </div>
          </>
        )}

        {/* Leader battle plan */}
        {leaderPlan && (
          <Card className="p-3 bg-amber-500/5 border-amber-500/30">
            <div className="flex items-center gap-2 mb-1.5">
              <Crown className="w-4 h-4 text-amber-500" />
              <span className="text-sm font-semibold">Leader&apos;s Battle Plan</span>
              <span className="text-[10px] text-muted-foreground">— sent to every writer agent</span>
            </div>
            <pre className="text-xs whitespace-pre-wrap text-muted-foreground max-h-40 overflow-y-auto">{leaderPlan}</pre>
          </Card>
        )}

        {/* Leader summary */}
        {summary && (
          <Card className="p-3 bg-primary/5 border-primary/30">
            <div className="flex items-center gap-2 mb-1.5">
              <BrainCircuit className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Leader Summary</span>
              <div className="flex-1" />
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={exportReport} title="Download this run's timeline + summary as a Markdown report">
                <Download className="w-3 h-3 mr-1" />Report
              </Button>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => { setRunning(false); setLogs([]); setSummary(''); setLeaderPlan(''); setBoard({}); setKeyStats({}); setTeamInfo(null); setPhase(''); setRunStartedAt(null) }}>
                <RefreshCw className="w-3 h-3 mr-1" />New run
              </Button>
            </div>
            {costUsd > 0 && (
              <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1" title="Real tokens from this run × public list prices — rough estimate, not an invoice">
                <Wallet className="w-3 h-3" />This run spent ≈ ${costUsd < 0.01 ? costUsd.toFixed(4) : costUsd.toFixed(2)} (rough list-price estimate)
              </div>
            )}
            <pre className="text-xs whitespace-pre-wrap text-muted-foreground max-h-40 overflow-y-auto">{summary}</pre>
          </Card>
        )}

        {/* Safety note */}
        <Card className="p-2 bg-amber-500/5 border-amber-500/30">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-[10px] text-muted-foreground">
              Big armies make many real API calls and consume your provider quota. In <strong>Keys = Agents</strong> mode
              every key runs as its own agent at the same time — add more keys in <strong>+AI → Add Provider</strong> to
              scale up (the same key cannot be added twice; different keys from the same provider are always welcome).
            </p>
          </div>
        </Card>

        {/* v58 — ⏰ scheduled runs (the army fires itself on a timer) */}
        <ScheduleDialog projectId={projectId} open={scheduleOpen} onOpenChange={setScheduleOpen} />

        {/* v59 — 🤖 Agent detail popup: everything the real events recorded
            about ONE agent — its task, verdict, provider/model/duration/tokens,
            files written, honest error, and a preview of what it produced. */}
        <Dialog open={boardDetailId !== null} onOpenChange={(b) => { if (!b) setBoardDetailId(null) }}>
          <DialogContent className="w-[calc(100%-1rem)] sm:max-w-lg max-h-[85dvh] overflow-y-auto">
            {(() => {
              const detailId = boardDetailId
              const e = detailId ? board[detailId] : undefined
              if (!e) return null
              return (
                <>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                      <span>{ROLE_EMOJI[e.role] || '🤖'}</span>
                      <span className="truncate">{detailId}</span>
                      <span className="text-[10px] font-normal text-muted-foreground">({e.role})</span>
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                      {e.status === 'working' ? '⏳ Working right now' :
                       e.status === 'switching' ? '🔁 Switching keys — will retry on the next healthy key' :
                       e.status === 'done' ? '✅ Finished successfully' : '❌ Failed'}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2 text-xs">
                    {e.task && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Task</div>
                        <div className="rounded-md border border-border bg-muted/20 p-2 whitespace-pre-wrap max-h-28 overflow-y-auto">{e.task}</div>
                      </div>
                    )}
                    {e.note && <div className="text-muted-foreground">Note: {e.note}</div>}
                    {(e.provider || e.durationMs !== undefined || e.tokensOut !== undefined) && (
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        {e.provider && <span>provider: <span className="text-foreground">{e.provider}</span></span>}
                        {e.model && <span>model: <span className="text-foreground">{e.model}</span></span>}
                        {e.durationMs !== undefined && <span>took: <span className="text-foreground">{(e.durationMs / 1000).toFixed(1)}s</span></span>}
                        {e.tokensOut !== undefined && <span>tokens out: <span className="text-foreground">{e.tokensOut}</span></span>}
                      </div>
                    )}
                    {e.files > 0 && <div className="text-[11px] text-sky-600 dark:text-sky-400">📝 {e.files} file(s) written to the project</div>}
                    {e.error && (
                      <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-red-600 dark:text-red-400">{e.error}</div>
                    )}
                    {e.preview && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">What it produced (first 300 chars)</div>
                        <pre className="rounded-md border border-border bg-muted/20 p-2 whitespace-pre-wrap text-[11px] max-h-40 overflow-y-auto">{e.preview}</pre>
                      </div>
                    )}
                  </div>
                </>
              )
            })()}
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}

function StatCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: string }) {
  return (
    <Card className="p-2 flex flex-col items-center gap-0.5">
      <Icon className={`w-4 h-4 ${tone}`} />
      <span className="text-lg font-bold leading-none">{value}</span>
      <span className="text-[9px] text-muted-foreground">{label}</span>
    </Card>
  )
}
