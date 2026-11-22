'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Send, Square as Stop, Paperclip, Loader2, ChevronDown, ChevronUp,
  Wrench, CheckCircle2, XCircle, AlertTriangle, User, Bot, Trash2, Mic,
  Volume2, Square as StopCircle, Crown, FileCode2, History, Globe, Network, X, Download, FileDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import { useAppStore } from '@/lib/store'

interface AgentMessage {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  toolName?: string
  toolArgs?: any
  toolResult?: any
  toolCallId?: string
  requiresConfirmation?: boolean
  pending?: boolean
  error?: boolean
}

interface AgentPanelProps {
  projectId: string
  providerId?: string | null
  defaultModel?: string
  fullHeight?: boolean
}

const WELCOME_MSG = 'Hello! I\'m Cloud Agent. Tell me what to build, modify, debug or explain. I can read & write files, run shell commands, install packages, start the dev server, and fix errors automatically.'

// ── v51: Swarm board — mirrors the {type:'swarm'} snapshot contract of
// src/lib/ai/swarm.ts (phase planning → assign → build → integrate → done). ──
interface SwarmBoardAgent {
  id: string
  name: string
  kind: string
  title: string
  status: 'pending' | 'building' | 'done' | 'failed'
  files: string[]
  error?: string
  startedAt?: number
  finishedAt?: number
}
interface SwarmBoardState {
  phase: string
  agents: SwarmBoardAgent[]
  plan?: string
  content?: string
}
// ── v51: per-project run history (🕘 header dropdown) ──
interface RunHistoryEntry {
  at: number
  ok: boolean
  durationMs: number
  files: number
  agents: number
  done: number
  failed: number
  tokensIn: number
  tokensOut: number
  prompt: string
  // v58: full (untruncated) prompt for the details card + one-click re-run
  fullPrompt?: string
  // v58: merged-from-DB extras shown in the details card
  response?: string
  model?: string | null
  provider?: string | null
}
// ── v51: saved agent pool (for the per-run picker) ──
interface PoolEntry {
  id: string
  name: string
  kind: string
  model: string
  role: string
  isDefault: boolean
}

const TRANSCRIPT_WINDOW = 300        // render the newest 300 messages; widen on demand
const BOARD_RENDER_CAP = 60          // DOM guard for huge swarms — every agent still builds
const RUN_HISTORY_CAP = 30           // newest-first, per project
const FOLDS_CAP = 300                // collapse-memory entries kept per project
const BUILD_BADGE = 'build 51'

/** v51: stable per-payload fold key — the SAME tool wall collapses/unfolds
 *  consistently across reloads. djb2 over name+args+output prefix. */
function foldKeyOf(m: AgentMessage): string {
  const raw = JSON.stringify([
    m.toolName,
    m.toolArgs,
    (m.toolResult?.output || '').slice(0, 400),
    (m.toolResult?.error || '').slice(0, 200),
  ])
  let h = 5381
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

function baseName(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}

export function AgentPanel({ projectId, providerId, defaultModel, fullHeight }: AgentPanelProps) {
  // Persist messages to localStorage keyed by project ID so that:
  //   - Closing the app and reopening it restores the chat
  //   - Switching projects restores each project's chat
  //   - The WebView being killed by Android doesn't lose history
  const storageKey = `ca:chat:${projectId}`
  const [messages, setMessages] = useState<AgentMessage[]>(() => {
    if (typeof window === 'undefined') return [{ role: 'assistant', content: WELCOME_MSG }]
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch {}
    return [{ role: 'assistant', content: WELCOME_MSG }]
  })
  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState(false)
  // v58: run details card opened from the 🕘 history
  const [runDetail, setRunDetail] = useState<RunHistoryEntry | null>(null)
  const [attachments, setAttachments] = useState<Array<{ name: string; content: string }>>([])
  const [expanded, setExpanded] = useState(true)
  const [tokensUsed, setTokensUsed] = useState({ in: 0, out: 0 })
  const [listening, setListening] = useState(false)
  // v68: last message that failed to send (gateway/network dead after all
  // retries) — one-tap resend chip above the composer instead of retyping.
  const [lastFailed, setLastFailed] = useState<string | null>(null)
  // v25.3 Unbreakable Runs: while rejoining after a mid-run connection drop
  const [rejoin, setRejoin] = useState<{ attempt: number; max: number } | null>(null)
  // Gentle "still working" reassurance when a run produces no output for a while
  const [slowRun, setSlowRun] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const runningRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Active server run id + how many buffered events this client processed.
  // The pair lets /api/agent/resume replay EXACTLY what we missed.
  const runIdRef = useRef<string | null>(null)
  const processedRef = useRef(0)

  // ── v51: Swarm board — live per-agent cards from {type:'swarm'} snapshots ──
  const [swarm, setSwarm] = useState<SwarmBoardState | null>(null)
  const [boardOpen, setBoardOpen] = useState(true)
  const swarmRef = useRef<SwarmBoardState | null>(null)

  // ── v51: per-project run history (🕘 header dropdown) ──
  const [runHistory, setRunHistory] = useState<RunHistoryEntry[]>([])

  // ── v51: transcript windowing — render the newest 300, one-tap widen ──
  const [windowSize, setWindowSize] = useState(TRANSCRIPT_WINDOW)

  // ── v51: auto-rejoin confirmation banner ──
  const [reconnected, setReconnected] = useState(false)

  // ── v51: per-run agent picker + ♻️ failover chip (persisted per project) ──
  const [pick, setPick] = useState<string>('all')
  const [failover, setFailover] = useState(true)
  const [pool, setPool] = useState<PoolEntry[]>([])

  // ── v51: collapse memory for code walls (persists per payload across reloads) ──
  const [folds, setFolds] = useState<Record<string, boolean>>({})

  // v51: run stats collected while the stream flows (history entry on done)
  const runStartRef = useRef(0)
  const writeCountRef = useRef(0)
  const swarmFilesRef = useRef(0)
  const swarmEverRef = useRef(false)
  const errSeenRef = useRef(false)
  const promptRef = useRef('')

  useEffect(() => {
    if (!running) { setSlowRun(false); return }
    const t = setTimeout(() => setSlowRun(true), 30_000)
    return () => clearTimeout(t)
  }, [running])

  // v63: Prompt Library "Use in chat" — a one-shot store handoff. Never
  // OVERWRITES text the owner already typed (appends instead). Replaces the
  // old ca:use-prompt window event, which was lost whenever the panel wasn't
  // mounted yet (welcome screen) — the store holds it until we mount.
  const pendingChatPrompt = useAppStore(s => s.pendingChatPrompt)
  useEffect(() => {
    if (!pendingChatPrompt) return
    setPrompt(prev => (prev.trim() ? `${prev}\n\n${pendingChatPrompt}` : pendingChatPrompt))
    useAppStore.getState().setPendingChatPrompt('')
  }, [pendingChatPrompt])

  // v51: reload per-project UI state when the project switches (additive —
  // chat messages keep the existing storageKey initializer behavior).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`ca:fold:${projectId}`)
      const parsed = raw ? JSON.parse(raw) : {}
      setFolds(parsed && typeof parsed === 'object' ? parsed : {})
    } catch { setFolds({}) }
    try { setPick(localStorage.getItem(`ca:runpick:${projectId}`) || 'all') } catch { setPick('all') }
    try { setFailover(localStorage.getItem(`ca:failover:${projectId}`) !== 'off') } catch { setFailover(true) }
    try {
      const raw = localStorage.getItem(`ca:runs:${projectId}`)
      const parsed = raw ? JSON.parse(raw) : []
      setRunHistory(Array.isArray(parsed) ? parsed : [])
    } catch { setRunHistory([]) }
    // v55: pull the durable server-side history (survives localStorage wipes
    // and device switches) — swarm runs included
    void loadServerRuns()
  }, [projectId])

  // v59 — ⬇ Export this project's durable run history as a real CSV file
  // (server-side AgentRun rows — the same truth the 🕘 dropdown merges).
  async function exportRunsCsv() {
    try {
      const r = await fetch(`/api/runs?format=csv&projectId=${encodeURIComponent(projectId)}&limit=200`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const text = await r.text()
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const stamp = new Date()
      a.href = url
      a.download = `runs-${(projectId || 'project').slice(0, 8)}-${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(stamp.getDate()).padStart(2, '0')}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('Run history downloaded as CSV')
    } catch (e: any) {
      toast.error(e?.message || 'Could not export the run history')
    }
  }

  // v55: merge DB-backed runs (AgentRun rows written by agent.ts + the swarm
  // route) into the 🕘 dropdown. Dedupe vs local entries by prompt+time;
  // entries older than an explicit user clear stay cleared.
  async function loadServerRuns() {
    try {
      const r = await fetch(`/api/runs?projectId=${encodeURIComponent(projectId)}&limit=50`)
      if (!r.ok) return
      const data = await r.json()
      const rows: any[] = data.runs || []
      if (!Array.isArray(rows) || rows.length === 0) return
      let clearedAt = 0
      try { clearedAt = Number(localStorage.getItem(`ca:runscleared:${projectId}`)) || 0 } catch {}
      setRunHistory(prev => {
        const same = (a: RunHistoryEntry, at: number, prompt: string) =>
          Math.abs(a.at - at) < 120_000 && (a.prompt || '').slice(0, 40) === (prompt || '').slice(0, 40)
        const merged: RunHistoryEntry[] = [...prev]
        for (const row of rows) {
          const at = new Date(row.createdAt).getTime()
          if (clearedAt && at < clearedAt) continue
          if (merged.some(e => same(e, at, row.prompt || ''))) continue
          const m = row.model === 'swarm' ? /swarm · (\d+) ok \/ (\d+) failed · (\d+) files/.exec(row.response || '') : null
          merged.push({
            at,
            ok: row.status === 'completed',
            durationMs: Math.max(0, new Date(row.updatedAt).getTime() - at),
            files: m ? Number(m[3]) : 0,
            agents: m ? Number(m[1]) + Number(m[2]) : 0,
            done: m ? Number(m[1]) : 0,
            failed: m ? Number(m[2]) : 0,
            tokensIn: row.tokensIn || 0,
            tokensOut: row.tokensOut || 0,
            prompt: (row.prompt || '').slice(0, 80),
            fullPrompt: row.prompt || '',
            response: (row.response || '').slice(0, 4000) || undefined,
            model: row.model,
            provider: row.provider,
          })
        }
        merged.sort((a, b) => b.at - a.at)
        const next = merged.slice(0, RUN_HISTORY_CAP)
        try { localStorage.setItem(`ca:runs:${projectId}`, JSON.stringify(next)) } catch {}
        return next
      })
    } catch {}
  }

  // v51: saved-agent pool for the picker (refreshed on open + after each run)
  async function refreshPool() {
    try {
      const r = await fetch('/api/providers')
      if (!r.ok) return
      const data = await r.json()
      const rows: PoolEntry[] = (data.providers || []).map((p: any) => ({
        id: p.id, name: p.name, kind: p.kind || '', model: p.model || '',
        role: p.role || 'work', isDefault: !!p.isDefault,
      }))
      setPool(rows)
    } catch {}
  }
  useEffect(() => { refreshPool() }, [projectId])

  // v51: choose the leader for this project's runs (persisted)
  function choosePick(id: string) {
    setPick(id)
    try { localStorage.setItem(`ca:runpick:${projectId}`, id) } catch {}
  }

  // v51: ♻️ failover toggle (persisted; disabled while a run is live)
  function toggleFailover() {
    if (runningRef.current) return
    const next = !failover
    setFailover(next)
    try { localStorage.setItem(`ca:failover:${projectId}`, next ? 'on' : 'off') } catch {}
  }

  // v51: collapse memory — per-payload fold state, capped, best-effort persist
  function toggleFold(key: string, next: boolean) {
    setFolds(prev => {
      const nextMap = { ...prev, [key]: next }
      const keys = Object.keys(nextMap)
      if (keys.length > FOLDS_CAP) {
        for (const k of keys.slice(0, keys.length - FOLDS_CAP)) delete nextMap[k]
      }
      try { localStorage.setItem(`ca:fold:${projectId}`, JSON.stringify(nextMap)) } catch {}
      return nextMap
    })
  }

  // v51: record a finished run into the project's 🕘 history (newest-first)
  function recordRunHistory(evt: any) {
    const board = swarmRef.current
    const agents = board?.agents || []
    const doneN = agents.filter(a => a.status === 'done').length
    const failedN = agents.filter(a => a.status === 'failed').length
    const files = swarmEverRef.current ? swarmFilesRef.current : writeCountRef.current
    const entry: RunHistoryEntry = {
      at: Date.now(),
      ok: evt?.ok !== false && !errSeenRef.current,
      durationMs: runStartRef.current ? Date.now() - runStartRef.current : 0,
      files,
      agents: agents.length,
      done: doneN,
      failed: failedN,
      tokensIn: evt?.tokensIn || 0,
      tokensOut: evt?.tokensOut || 0,
      prompt: (promptRef.current || '').slice(0, 80),
      fullPrompt: promptRef.current || '',
    }
    setRunHistory(prev => {
      const next = [entry, ...prev].slice(0, RUN_HISTORY_CAP)
      try { localStorage.setItem(`ca:runs:${projectId}`, JSON.stringify(next)) } catch {}
      return next
    })
  }

  // v51: hidden-tab ping — the run finished/failed while the user is away
  // v58: + attention grabber (sound + title flash) so an unbreakable run
  // that finishes in the background is impossible to miss when you come back
  const titleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  function notifyRunEnd(okRun: boolean, detail: string) {
    try {
      // v60: notification center — EVERY finished single run lands here
      // (visible or not), so the bell always shows the true run history.
      useAppStore.getState().pushNotification({
        kind: 'single',
        ok: okRun,
        title: okRun ? 'Run finished' : 'Run failed',
        detail: detail.slice(0, 200),
      })
    } catch {}
    try {
      if (typeof window === 'undefined' || typeof document === 'undefined') return
      if (!document.hidden) return // visible → no ping needed

      // 1) short synthesized beep (no audio assets needed) — success gets a
      //    rising two-tone, failure one low tone. AudioContext may be
      //    suspended without a prior user gesture; honest try/catch.
      try {
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
        if (Ctx) {
          const ctx = new Ctx()
          const beep = (freq: number, at: number, dur: number) => {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.type = 'sine'
            osc.frequency.value = freq
            gain.gain.setValueAtTime(0.0001, ctx.currentTime + at)
            gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + at + 0.02)
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur)
            osc.start(ctx.currentTime + at)
            osc.stop(ctx.currentTime + at + dur + 0.05)
          }
          if (okRun) {
            beep(880, 0, 0.18)
            beep(1174.7, 0.24, 0.24)
          } else {
            beep(311, 0, 0.4)
          }
          setTimeout(() => {
            try {
              ctx.close()
            } catch {}
          }, 1200)
        }
      } catch {}

      // 2) desktop notification (existing behaviour)
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Cloud Agent', { body: `${okRun ? '✅ Run finished' : '❌ Run failed'} — ${detail}`.slice(0, 180), tag: 'ca-run-end' })
      }

      // 3) title flash until the user looks back at this tab
      if (titleTimerRef.current) clearInterval(titleTimerRef.current)
      const originalTitle = document.title
      let flip = false
      titleTimerRef.current = setInterval(() => {
        flip = !flip
        document.title = flip ? `${okRun ? '✅' : '❌'} Run finished — Cloud Agent` : originalTitle
      }, 1200)
      const onVisible = () => {
        if (!document.hidden) {
          if (titleTimerRef.current) clearInterval(titleTimerRef.current)
          titleTimerRef.current = null
          document.title = originalTitle
          document.removeEventListener('visibilitychange', onVisible)
        }
      }
      document.addEventListener('visibilitychange', onVisible)
    } catch {}
  }

  // Save messages to localStorage (debounced) — writing on every streamed
  // token causes O(n²) JSON serialization jank on long chats.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const t = setTimeout(() => {
      try {
        // Strip pending/error flags before saving (those are transient)
        const toSave = messages.map(m => ({ ...m, pending: false }))
        localStorage.setItem(storageKey, JSON.stringify(toSave))
      } catch {}
    }, 600)
    return () => clearTimeout(t)
  }, [messages, storageKey])

  // Clear chat button — wipes the project's saved history
  function clearChat() {
    if (!confirm('Clear all chat history for this project? This cannot be undone.')) return
    try { localStorage.removeItem(storageKey) } catch {}
    // v55: also mark the run history as cleared at this moment — durable DB
    // rows older than this never resurrect in the 🕘 dropdown (nothing is
    // deleted server-side; the marker only filters the view)
    try { localStorage.setItem(`ca:runscleared:${projectId}`, String(Date.now())) } catch {}
    try {
      const next: RunHistoryEntry[] = []
      localStorage.setItem(`ca:runs:${projectId}`, JSON.stringify(next))
    } catch {}
    setRunHistory([])
    setMessages([{ role: 'assistant', content: WELCOME_MSG }])
  }

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  /** v68 — export the visible chat transcript as a Markdown file
   *  (user/assistant/tool turns, errors flagged). Pure client-side. */
  function exportChatMd() {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const parts: string[] = [
      `# Cloud Agent chat transcript`,
      ``,
      `- Project: \`${projectId}\``,
      `- Exported: ${stamp}`,
      `- Turns: ${messages.length}`,
      ``,
      `---`,
      ``,
    ]
    for (const m of messages) {
      if (m.pending) continue
      if (m.role === 'user') {
        parts.push(`## 🧑 You`, ``, m.content, ``)
      } else if (m.toolName) {
        parts.push(`### 🔧 Tool · ${m.toolName}`, '', '```', m.content.slice(0, 4000), '```', ``)
      } else {
        parts.push(`## 🤖 Cloud Agent`, '', m.content, m.error ? `> ⚠️ this turn failed` : '', ``)
      }
    }
    const blob = new Blob([parts.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `chat-${projectId.slice(0, 8)}-${Date.now()}.md`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    toast.success('Chat transcript downloaded (.md)')
  }

  async function send(override?: string) {
    const text = (override ?? prompt).trim()
    if (!text || runningRef.current) return
    runningRef.current = true
    const userMsg: AgentMessage = { role: 'user', content: text }
    setMessages(m => [...m, userMsg])
    promptRef.current = text // v51: remembered for the 🕘 history entry
    setPrompt('')
    setLastFailed(null) // v68: optimistic clear — the catch re-sets it if send dies again
    setRunning(true)
    // Fresh run → fresh ids. runIdRef fills from the server's run_started
    // event (first line of every stream) and drives /api/agent/resume.
    runIdRef.current = null
    processedRef.current = 0
    // v51: reset run-stats collectors — the board, counters and the
    // reconnected banner describe ONE run, not the panel's lifetime.
    setSwarm(null)
    swarmRef.current = null
    writeCountRef.current = 0
    swarmFilesRef.current = 0
    swarmEverRef.current = false
    errSeenRef.current = false
    setReconnected(false)
    runStartRef.current = Date.now()
    // v51: best-effort notification opt-in — the user just pressed Send,
    // so asking now is a natural moment (fires only when still 'default').
    try {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {})
      }
    } catch {}

    const controller = new AbortController()
    abortRef.current = controller

    // Build conversation history from past messages — only user and assistant
    // text messages (skip tool-call intermediate results to keep context clean).
    // This lets the agent remember what was asked before and continue the work.
    const history = messages
      .filter(m => (m.role === 'user' || (m.role === 'assistant' && !m.toolName)) && !m.error)
      .slice(-200) // keep last 200 turns — unlimited for sole user
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

    try {
      let res: Response
      try {
        // v67 GATEWAY-RETRY: the embedded preview sits behind a proxy that
        // answers 502/503/504 when the builder server is busy compiling or
        // restarting — the owner saw "Error: HTTP 502"/"Failed to fetch" the
        // moment they sent a big task. A 502/503/504 (or a network-level
        // throw BEFORE any headers arrive) means the run NEVER STARTED, so
        // retrying is safe — no duplicate run. Our own 4xx (400/401/402)
        // still fails fast with the real message.
        const RETRIES = 3
        let lastErr: any = null
        res = null as any
        for (let attempt = 1; attempt <= RETRIES; attempt++) {
          try {
            const r = await fetch('/api/agent', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                projectId,
                prompt: text,
                // v51 per-run agent picker: 'all' → absent providerId = the whole
                // swarm (default leader order); a specific pick = that agent LEADS
                // the swarm (planner/integrator). The Dashboard default still
                // applies until the picker has loaded its pool.
                providerId: pick !== 'all' ? pick : (providerId || undefined),
                failover, // v51 ♻️ strict mode: body.failover === false → own key only
                attachments,
                history,
                runId: runIdRef.current || undefined,
              }),
              signal: controller.signal,
            })
            if (r.status === 502 || r.status === 503 || r.status === 504) {
              lastErr = new Error(`HTTP ${r.status}`)
              if (attempt < RETRIES) {
                setMessages(m => [...m.slice(0, -1), { role: 'assistant', content: `⏳ Gateway hiccup (HTTP ${r.status}) — the server is warming up. Retrying ${attempt + 1}/${RETRIES}…`, pending: true }])
                await new Promise(rr => setTimeout(rr, 900 * attempt))
                continue
              }
            }
            res = r
            break
          } catch (e2: any) {
            if (e2.name === 'AbortError') return
            lastErr = e2
            if (attempt < RETRIES) {
              setMessages(m => [...m.slice(0, -1), { role: 'assistant', content: `⏳ Network hiccup (${e2.message || 'connection failed'}) — retrying ${attempt + 1}/${RETRIES}…`, pending: true }])
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
      } catch (e: any) {
        if (e.name === 'AbortError') return
        throw e // pre-run failure — nothing to resume, handled by outer catch
      }

      // v25.3: if the connection drops mid-run, the run KEEPS GOING on the
      // server — we just rejoin it via /api/agent/resume.
      const outcome = await consumeStream(res, controller)
      if (outcome === 'dropped') await rejoinLoop()
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        toast.error(e.message)
        setMessages(m => [...m, { role: 'assistant', content: `Error: ${e.message}`, error: true }])
        // v68: keep the message — one tap above the composer resends it
        setLastFailed(text)
      }
    } finally {
      // Safety net: resolve any bubbles still pending (error mid-stream, abort, etc.)
      setMessages(m => {
        const changed = m.some(msg => msg.pending)
        if (!changed) return m
        return m.map(msg => (msg.pending ? { ...msg, pending: false, toolResult: msg.toolResult || { ok: true, output: '(stopped)', error: '' } } : msg))
      })
      runningRef.current = false
      setRunning(false)
      abortRef.current = null
      setAttachments([])
    }
  }

  /** Consume one NDJSON stream (initial run OR a resume replay+tail).
   *  Returns 'dropped' when the NETWORK died mid-stream (→ rejoinLoop),
   *  'completed' when the server closed the stream normally. */
  async function consumeStream(res: Response, _controller: AbortController): Promise<'completed' | 'dropped'> {
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let assistantText = ''
    let assistantStarted = false

    const handleEvent = (evt: any) => {
      if (!evt || typeof evt !== 'object') return
      // 'resumed' is a synthesized meta line (not part of the server's
      // buffered event array) — must NOT advance processedRef.
      if (evt.type !== 'resumed') processedRef.current++
      if (evt.type === 'run_started' && evt.runId) {
        if (runIdRef.current !== evt.runId) {
          // v51: a FRESH run (not a resume replay) → reset the board and the
          // run-stats collectors so they describe this run only.
          setSwarm(null)
          swarmRef.current = null
          writeCountRef.current = 0
          swarmFilesRef.current = 0
          swarmEverRef.current = false
          errSeenRef.current = false
          setReconnected(false)
          if (!runStartRef.current) runStartRef.current = Date.now()
        }
        runIdRef.current = evt.runId
        return
      }
      if (evt.type === 'resumed') return

      // v51: live swarm snapshots drive the board. Files are counted from the
      // snapshot (deduped) so the 🕘 history reports REAL written files.
      if (evt.type === 'swarm') {
        swarmEverRef.current = true
        const agents: SwarmBoardAgent[] = Array.isArray(evt.agents) ? evt.agents : []
        swarmFilesRef.current = new Set(agents.flatMap(a => a.files || [])).size
        const board: SwarmBoardState = { phase: evt.phase, agents, plan: evt.plan, content: evt.content }
        swarmRef.current = board
        setSwarm(board)
        return
      }
      if (evt.type === 'heartbeat') return // keep-alive — nothing to render
      if (evt.type === 'token' && evt.content) {
        if (!assistantStarted) {
          assistantStarted = true
          assistantText = evt.content
          setMessages(m => [...m, { role: 'assistant', content: assistantText, pending: true }])
        } else {
          assistantText += evt.content
          setMessages(m => {
            const copy = [...m]
            const last = copy[copy.length - 1]
            // Only mutate the last message if it's still our streaming assistant bubble.
            // After a tool_call, the last message is a tool bubble — start a NEW
            // assistant message instead (iteration 2+ text was previously lost).
            if (last && last.role === 'assistant' && last.pending) {
              copy[copy.length - 1] = { ...last, content: assistantText, pending: true }
              return copy
            }
            return [...copy, { role: 'assistant', content: assistantText, pending: true }]
          })
        }
      } else if (evt.type === 'tool_call') {
        // Finalize the assistant message and reset the stream state so the
        // next iteration's tokens start a fresh assistant bubble.
        assistantStarted = false
        assistantText = ''
        // v51: real write_file calls feed the 🕘 history file counter when no
        // swarm snapshot is present (single-agent path).
        if (evt.toolName === 'write_file') writeCountRef.current++
        setMessages(m => {
          const copy = [...m]
          if (copy.length > 0 && copy[copy.length - 1].role === 'assistant') {
            copy[copy.length - 1] = { ...copy[copy.length - 1], pending: false }
          }
          return [...copy, { role: 'tool', content: '', toolName: evt.toolName, toolArgs: evt.toolArgs, toolCallId: evt.toolCallId, pending: true }]
        })
      } else if (evt.type === 'tool_result') {
        setMessages(m => {
          const copy = [...m]
          // Match by tool_call_id if available — otherwise fall back to last tool message
          const idMatch = evt.toolCallId
            ? copy.findIndex(msg => msg.role === 'tool' && msg.toolCallId === evt.toolCallId)
            : -1
          if (idMatch >= 0) {
            copy[idMatch] = {
              ...copy[idMatch],
              toolResult: evt.toolResult,
              requiresConfirmation: evt.requiresConfirmation,
              pending: false,
              error: !evt.toolResult?.ok,
            }
          } else if (copy.length > 0 && copy[copy.length - 1].role === 'tool') {
            // Fallback: update last tool message
            copy[copy.length - 1] = {
              ...copy[copy.length - 1],
              toolResult: evt.toolResult,
              requiresConfirmation: evt.requiresConfirmation,
              pending: false,
              error: !evt.toolResult?.ok,
            }
          }
          return copy
        })
      } else if (evt.type === 'message') {
        // Full text for this iteration (emitted after tokens). Only append
        // if we never received tokens for it (non-streaming providers) or
        // the streamed bubble is missing.
        const text = (evt.content || '').trim()
        if (text && !assistantStarted) {
          setMessages(m => {
            const copy = [...m]
            const last = copy[copy.length - 1]
            if (last && last.role === 'assistant' && last.content === evt.content) return copy
            return [...copy, { role: 'assistant', content: evt.content }]
          })
        }
      } else if (evt.type === 'done') {
        setMessages(m => {
          const copy = [...m]
          // Mark all pending tool messages as completed (safety net for stuck spinners)
          for (let i = 0; i < copy.length; i++) {
            if (copy[i].pending) {
              copy[i] = {
                ...copy[i],
                pending: false,
                toolResult: copy[i].toolResult || { ok: true, output: '(agent finished)', error: '' },
              }
            }
          }
          return copy
        })
        if (evt.tokensIn) setTokensUsed(t => ({ in: t.in + evt.tokensIn, out: t.out + evt.tokensOut }))
        // v51: persist the run into 🕘 history + ping the hidden tab
        recordRunHistory(evt)
        const board = swarmRef.current
        const agentsN = board?.agents?.length || 0
        const detail = agentsN > 0
          ? `${(board?.agents || []).filter((a: SwarmBoardAgent) => a.status === 'done').length}/${agentsN} agents · ${swarmEverRef.current ? swarmFilesRef.current : writeCountRef.current} file(s)`
          : `${swarmEverRef.current ? swarmFilesRef.current : writeCountRef.current} file(s) written`
        notifyRunEnd(evt.ok !== false && !errSeenRef.current, detail)
        refreshPool() // v51: pool can change (Provider Manager) — keep the picker fresh
        // Refresh tree after agent work
        useAppStore.getState().bumpTree()
      } else if (evt.type === 'error') {
        // Finalize any stuck pending bubbles (spinners never resolved before)
        assistantStarted = false
        assistantText = ''
        errSeenRef.current = true // v51: an error event means the run was NOT clean
        setMessages(m => m.map(msg => (msg.pending ? { ...msg, pending: false, toolResult: msg.toolResult || { ok: false, output: '', error: 'interrupted' } } : msg)))
        // Provide a helpful, actionable error message
        const errMsg = evt.content || 'Unknown error'
        let helpHint = ''
        if (/413|too large|payload too large|body.*too.*big/i.test(errMsg)) {
          helpHint = '\n\n💡 The request body was too large. Try splitting your prompt into smaller pieces, or remove large attachments.'
        } else if (/timeout|timed out/i.test(errMsg)) {
          helpHint = '\n\n💡 The request timed out. For large builds, this is normal — try again with a simpler prompt.'
        } else if (/401|unauthor|invalid.*key/i.test(errMsg)) {
          helpHint = '\n\n💡 API key issue. Check the Provider Manager (top-right button) — your key may be expired or invalid.'
        } else if (/429|rate.*limit|quota/i.test(errMsg)) {
          helpHint = '\n\n💡 Rate limit hit. Wait 60s, or add more provider keys in the Provider Manager.'
        } else if (/402|insufficient.*balance|no credits|out of credit/i.test(errMsg)) {
          helpHint = '\n\n💡 This provider account has no balance left. Top it up on the provider dashboard — or add a FREE provider (Gemini free tier, Groq) in the Provider Manager.'
        } else if (/403|forbidden|ip.*block|cloudflare/i.test(errMsg)) {
          helpHint = '\n\n💡 The provider blocked the server IP. Try a different provider or use the built-in Vortex Engine.'
        } else if (/context.*length|too many tokens|prompt.*too.*long/i.test(errMsg)) {
          helpHint = '\n\n💡 Prompt is too long for this model. Try a model with larger context (like GLM-4, Claude 3, GPT-4 Turbo).'
        } else if (/network|fetch|ECONNREFUSED|ENOTFOUND/i.test(errMsg)) {
          helpHint = '\n\n💡 Network error reaching the provider. Check your internet connection or try a different provider.'
        }
        toast.error(errMsg.slice(0, 200))
        setMessages(m => [...m, { role: 'assistant', content: `❌ **Error:** ${errMsg}${helpHint}`, error: true }])
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          let evt: any
          try { evt = JSON.parse(line) } catch { continue }
          handleEvent(evt)
        }
      }
      return 'completed'
    } catch {
      // Network died mid-stream. The RUN is still alive on the server —
      // the caller rejoins it via /api/agent/resume.
      return 'dropped'
    }
  }

  /** v25.3 Unbreakable Runs — rejoin a live server-side run after the
   *  device's connection dropped. Replays missed events from the run
   *  buffer and live-tails until the run finishes. */
  async function rejoinLoop() {
    const MAX = 12
    for (let attempt = 1; attempt <= MAX; attempt++) {
      if (!runningRef.current) { setRejoin(null); return } // user pressed Stop
      setRejoin({ attempt, max: MAX })
      await new Promise(r => setTimeout(r, Math.min(1200 * attempt, 5000)))
      if (!runningRef.current) { setRejoin(null); return }
      try {
        const res = await fetch('/api/agent/resume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: runIdRef.current, from: processedRef.current }),
        })
        if (res.status === 404) {
          setRejoin(null)
          setMessages(m => [...m, { role: 'assistant', content: 'ℹ️ The connection dropped and the run is no longer in server memory (the builder server restarted, or the 15-minute replay window passed). Everything the agent already wrote to your project is safe — check Files/Preview. Send a short follow-up like "continue" to pick up where it left off.' }])
          return
        }
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
        const outcome = await consumeStream(res, abortRef.current!)
        if (outcome === 'completed') {
          setRejoin(null)
          // v51: CONFIRM the recovery — the user must KNOW nothing was lost.
          setReconnected(true)
          setTimeout(() => setReconnected(false), 12_000)
          return
        }
        // dropped again → next attempt
      } catch (e: any) {
        if (e?.name === 'AbortError') { setRejoin(null); return }
        // transient — back off and try again
      }
    }
    setRejoin(null)
    setMessages(m => [...m, { role: 'assistant', content: '⚠️ The connection kept dropping, so this page stopped rejoining — but your agent run CONTINUED on the server and has likely finished by now. Everything it wrote is in your project (check Files/Preview). Send "continue" if you want more work done.' }])
  }

  function stop() {
    // v25.3: killing the viewer connection no longer stops the run — the
    // Stop button must explicitly abort it server-side too.
    const rid = runIdRef.current
    if (rid && runningRef.current) {
      fetch('/api/agent/abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: rid }),
      }).catch(() => {})
    }
    abortRef.current?.abort()
    runningRef.current = false
    setRunning(false)
    setRejoin(null)
  }

  // v51: transcript windowing — the newest windowSize messages render; older
  // ones collapse into a one-tap widen button (flood protection for long
  // builds and 200-agent swarms; nothing is deleted, only deferred).
  const visibleOffset = Math.max(0, messages.length - windowSize)
  const visibleMessages = messages.slice(visibleOffset)
  const hiddenCount = visibleOffset

  async function handleAttach(type: 'file' | 'image' | 'zip') {
    const input = document.createElement('input')
    input.type = 'file'
    if (type === 'image') input.accept = 'image/*'
    // v63: AIA (MIT App Inventor) files are ZIPs too — the old accept list
    // only allowed .zip so the advertised AIA attach could not be selected.
    if (type === 'zip') input.accept = '.zip,.aia'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      if (type === 'image') {
        // Save the image INTO the project (binary write) so the agent can
        // inspect/reference it — the old placeholder text attached nothing.
        try {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result))
            reader.onerror = reject
            reader.readAsDataURL(file)
          })
          const base64 = dataUrl.split(',')[1] || ''
          const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
          const res = await fetch('/api/files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, path: `assets/${safeName}`, op: 'writeBase64', contentBase64: base64 }),
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          setAttachments(a => [...a, { name: safeName, content: `[Image saved to project: assets/${safeName} (${file.type || 'image/' + ext}, ${Math.round(base64.length * 3 / 4 / 1024)} KB). Use terminal/read tools to inspect it if needed.]` }])
          useAppStore.getState().bumpTree()
          toast.success(`Image saved to assets/${safeName}`)
        } catch (e: any) {
          toast.error(`Image attach failed: ${e.message}`)
        }
        return
      }
      // v63: archives are BINARY — the old `file.text()` read ran the bytes
      // through UTF-8 decoding, so every real ZIP arrived corrupted. Now the
      // archive goes into the project byte-exact via writeBase64 and the
      // attachment tells the agent where it lives and how to unpack it.
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
        const base64 = dataUrl.split(',')[1] || ''
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const res = await fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, path: `uploads/${safeName}`, op: 'writeBase64', contentBase64: base64 }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setAttachments(a => [...a, { name: safeName, content: `[Archive uploaded byte-exact to: uploads/${safeName} (${Math.round(base64.length * 3 / 4 / 1024)} KB). Unpack it with the terminal, e.g.: unzip -o uploads/${safeName} -d . (or: tar -xzf for .tar.gz) — .aia files are ZIP archives inside.]` }])
        useAppStore.getState().bumpTree()
        toast.success(`${safeName} saved to uploads/ (${Math.round(base64.length * 3 / 4 / 1024)} KB)`)
      } catch (e: any) {
        toast.error(`Archive attach failed: ${e.message}`)
      }
    }
    input.click()
  }

  return (
    <div className="flex flex-col bg-card/30 h-full" style={{ height: fullHeight ? '100%' : (expanded ? 'min(40vh, 360px)' : '40px') }}>
      {/* Header */}
      <div
        className={`flex items-center justify-between px-3 py-1.5 border-b border-border ${fullHeight ? '' : 'cursor-pointer hover:bg-muted/30'}`}
        onClick={() => { if (!fullHeight) setExpanded(!expanded) }}
      >
        <div className="flex items-center gap-2">
          <Bot className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider">Cloud Agent</span>
          {defaultModel && <Badge variant="outline" className="text-[10px] py-0 h-4">{defaultModel}</Badge>}
          {running && <Badge variant="outline" className="text-[10px] py-0 h-4 ca-bg-building ca-status-building">Working...</Badge>}
          <Badge variant="outline" className="hidden sm:inline-flex text-[10px] py-0 h-4 text-muted-foreground">
            {BUILD_BADGE} · {pool.length > 0 ? `${pool.length} providers` : 'built-in Vortex Engine'} · swarm board
          </Badge>
          {(tokensUsed.in > 0 || tokensUsed.out > 0) && (
            <span className="text-[10px] text-muted-foreground">tokens in: {tokensUsed.in} · out: {tokensUsed.out}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* v68: one-tap chat transcript export (.md) — pure client-side */}
          {messages.length > 1 && (
            <Button
              variant="ghost" size="icon" className="h-5 w-5"
              title="Download this chat transcript as a Markdown file (.md)"
              onClick={(e) => { e.stopPropagation(); exportChatMd() }}
            >
              <FileDown className="w-3 h-3" />
            </Button>
          )}
          {runHistory.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-5 w-5" title="🕘 Run history — this project" onClick={(e) => e.stopPropagation()}>
                  <History className="w-3 h-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 max-h-80 overflow-y-auto">
                <div className="px-2 py-1.5 text-[11px] font-semibold text-muted-foreground border-b border-border/60 flex items-center justify-between gap-2">
                  <span>🕘 Run history — newest first · tap a run for details</span>
                  <button
                    className="text-[10px] font-normal inline-flex items-center gap-1 text-primary hover:underline shrink-0"
                    title="Download this project's run history as a CSV spreadsheet (server-side DB rows, up to 200)"
                    onClick={(e) => { e.stopPropagation(); void exportRunsCsv() }}
                  >
                    <Download className="w-3 h-3" />CSV
                  </button>
                </div>
                {runHistory.map((r, i) => (
                  <button
                    key={i}
                    className="w-full text-left px-2 py-1.5 text-[11px] border-b border-border/30 last:border-b-0 hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      setRunDetail(r)
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{r.ok ? '✅ finished' : '❌ failed'} · {new Date(r.at).toLocaleString()}</span>
                      <span className="text-muted-foreground shrink-0">{formatDuration(r.durationMs)}</span>
                    </div>
                    <div className="text-muted-foreground">
                      {r.agents > 0 ? `${r.done}/${r.agents} agents done${r.failed > 0 ? `, ${r.failed} failed` : ''} · ` : ''}{r.files} file(s){(r.tokensIn > 0 || r.tokensOut > 0) ? ` · tokens ${r.tokensIn}/${r.tokensOut}` : ''}
                    </div>
                    {r.prompt && <div className="truncate text-muted-foreground/70">“{r.prompt}”</div>}
                  </button>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {messages.length > 1 && (
            <Button variant="ghost" size="icon" className="h-5 w-5" title="Clear chat" onClick={(e) => { e.stopPropagation(); clearChat() }}>
              <Trash2 className="w-3 h-3" />
            </Button>
          )}
          {/* v63: this chevron had NO onClick — on desktop it only worked by
              event bubbling to the header; on mobile (fullHeight) the header
              handler is a no-op, so the visible Collapse/Expand button did
              literally nothing. Explicit handler + stopPropagation now, and
              it hides where collapsing is impossible (mobile full-height). */}
          {!fullHeight && (
            <Button variant="ghost" size="icon" className="h-5 w-5" title={expanded ? 'Collapse' : 'Expand'} onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}>
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
            </Button>
          )}
        </div>
      </div>

      {(expanded || fullHeight) && (
        <>
          {/* v51: Swarm board — live per-agent cards from {type:'swarm'} snapshots.
              Appears while the swarm builds and stays visible with final counts
              until the next run replaces it. Single-agent runs never show it. */}
          {swarm && (
            <SwarmBoard
              board={swarm}
              open={boardOpen}
              onToggle={() => setBoardOpen(o => !o)}
            />
          )}

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
            {hiddenCount > 0 && (
              <button
                className="w-full text-center text-[11px] text-primary hover:underline py-1"
                onClick={() => setWindowSize(messages.length)}
              >
                Show earlier messages ({hiddenCount} hidden)
              </button>
            )}
            {visibleMessages.map((m, i) => (
              <MessageBubble
                key={visibleOffset + i}
                msg={m}
                foldKey={m.role === 'tool' ? foldKeyOf(m) : undefined}
                folded={m.role === 'tool' ? !!folds[foldKeyOf(m)] : undefined}
                onToggleFold={toggleFold}
              />
            ))}
            {running && messages[messages.length - 1]?.role === 'user' && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Thinking...
              </div>
            )}
            {running && slowRun && !rejoin && (
              <div className="text-[11px] text-muted-foreground/80 pl-5">
                Still working — big builds take a few minutes. Even if your network blips, the agent keeps running and this page rejoins automatically.
              </div>
            )}
            {rejoin && (
              <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded p-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 mt-0.5" />
                <span>
                  Connection hiccup — your agent is STILL RUNNING on the server, nothing was lost.
                  {' '}Rejoining… (attempt {rejoin.attempt}/{rejoin.max})
                </span>
              </div>
            )}
            {reconnected && !rejoin && (
              <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 rounded p-2">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Reconnected — every missed event was replayed. Nothing was lost.</span>
              </div>
            )}
          </div>

          {/* Attachments preview */}
          {attachments.length > 0 && (
            <div className="px-3 pb-1 flex flex-wrap gap-1">
              {attachments.map((a, i) => (
                <Badge key={i} variant="outline" className="text-[10px]">
                  {a.name}
                  <button
                    className="ml-1 hover:text-destructive"
                    onClick={() => setAttachments(arr => arr.filter((_, idx) => idx !== i))}
                  >×</button>
                </Badge>
              ))}
            </div>
          )}

          {/* v51: run controls — per-run agent picker + ♻️ failover chip */}
          <div className="px-3 pb-1 flex flex-wrap items-center gap-1.5">
            <DropdownMenu onOpenChange={(o) => { if (o) refreshPool() }}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-6 text-[11px] px-2 font-normal" disabled={running}>
                  {pick === 'all' ? (
                    <><Globe className="w-3 h-3 mr-1 text-emerald-500" />All agents ({pool.length || 1}) — parallel swarm</>
                  ) : (
                    (() => {
                      const p = pool.find(x => x.id === pick)
                      return <><span className="mr-1">{p?.role === 'leader' ? '👑' : '🤖'}</span>{p?.name || 'Saved agent'} leads the swarm</>
                    })()
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64 max-h-64 overflow-y-auto">
                <DropdownMenuItem onClick={() => choosePick('all')} className="text-[11px]">
                  <Globe className="w-3 h-3 mr-1.5 text-emerald-500" />
                  All agents ({pool.length || 1}) — parallel swarm
                </DropdownMenuItem>
                {pool.map(p => (
                  <DropdownMenuItem key={p.id} onClick={() => choosePick(p.id)} className="text-[11px]">
                    <span className="mr-1.5">{p.role === 'leader' ? '👑' : '🤖'}</span>
                    <span className="truncate">{p.name} · {p.model || p.kind || 'agent'}</span>
                    {p.isDefault && <Badge variant="outline" className="ml-auto text-[9px] py-0 h-3.5 shrink-0">default</Badge>}
                  </DropdownMenuItem>
                ))}
                {pool.length === 0 && (
                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                    No saved agents yet — the built-in Vortex Engine builds solo. Add your keys in the Provider Manager to grow the swarm.
                  </div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              className={`h-6 px-2 rounded-md border text-[11px] font-medium transition-colors disabled:opacity-50 ${failover ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' : 'border-amber-500/40 bg-amber-500/10 text-amber-500'}`}
              disabled={running}
              onClick={toggleFailover}
              title={failover
                ? '♻️ Failover ON — a broken agent is rescued down the other agents\' keys (built-in Vortex Engine last resort)'
                : '♻️ Failover OFF — STRICT: every agent builds with its own key only; failures surface honestly'}
            >
              ♻️ failover {failover ? 'ON' : 'OFF · strict'}
            </button>
          </div>

          {/* Input */}
          <div className="px-3 py-2 border-t border-border">
            {/* v68: one-tap resend of a message whose send died (gateway/network) */}
            {lastFailed && !running && (
              <div className="flex items-center justify-between gap-2 mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5">
                <span className="text-[11px] text-amber-600 dark:text-amber-400 truncate" title={lastFailed}>
                  ⚠️ Last message failed to send — tap to resend
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-500 text-black hover:bg-amber-400"
                    onClick={() => { const t = lastFailed; setLastFailed(null); send(t) }}
                  >
                    ↻ Resend
                  </button>
                  <button className="text-[11px] text-muted-foreground hover:text-foreground px-1" onClick={() => setLastFailed(null)} title="Dismiss">
                    ✕
                  </button>
                </div>
              </div>
            )}
            <div className="flex items-end gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={running}>
                    <Paperclip className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => handleAttach('file')}>Upload source file</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAttach('image')}>Upload image/screenshot</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAttach('zip')}>Upload ZIP / AIA / project</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAttach('file')}>Upload document</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {/* Voice button — uses browser's Web Speech API for speech-to-text */}
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 shrink-0 ${listening ? 'bg-red-500/20 text-red-500 animate-pulse' : ''}`}
                disabled={running}
                onClick={() => {
                  if (typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
                    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition
                    if (!listening) {
                      const recognition = new SR()
                      recognition.continuous = false
                      recognition.interimResults = true
                      // Use the browser UI language (falls back sensibly for Bengali users)
                      const uiLang = navigator.language || 'en-US'
                      recognition.lang = uiLang.toLowerCase().startsWith('bn') ? 'bn-BD' : uiLang
                      recognition.onresult = (e: any) => {
                        const transcript = Array.from(e.results).map((r: any) => r[0].transcript).join('')
                        setPrompt(prev => prev + transcript)
                      }
                      recognition.onend = () => setListening(false)
                      recognition.onerror = () => setListening(false)
                      recognition.start()
                      setListening(true)
                    }
                  } else {
                    toast.error('Voice input not supported in this browser')
                  }
                }}
                title="Voice input"
              >
                <Mic className="w-4 h-4" />
              </Button>
              <Textarea
                placeholder="Ask Cloud Agent to build, modify, debug or explain your project..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    send()
                  }
                }}
                disabled={running}
                className="flex-1 min-h-[60px] max-h-[400px] resize-y text-sm"
                rows={1}
              />
              {running ? (
                <Button variant="destructive" size="icon" className="h-8 w-8 shrink-0" onClick={stop}>
                  <Stop className="w-4 h-4" />
                </Button>
              ) : (
                <Button size="icon" className="h-8 w-8 shrink-0" onClick={() => send()} disabled={!prompt.trim()}>
                  <Send className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>

          {/* v58 — 🕘 Run details card: full prompt + metrics + the stored
              leader response, with a one-click "Run again" that re-fills the
              input (single) or opens the Army panel pre-filled (swarm). */}
          {runDetail && (
            <div className="fixed inset-0 z-[90] bg-black/60 flex items-center justify-center p-4" onClick={() => setRunDetail(null)}>
              <div
                className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border/60">
                  <div className="text-sm font-semibold flex items-center gap-1.5">
                    {runDetail.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
                    {runDetail.ok ? 'Run finished' : 'Run failed'} · {new Date(runDetail.at).toLocaleString()}
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRunDetail(null)}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <div className="px-4 py-3 overflow-y-auto space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-1.5 text-[11px] text-muted-foreground">
                    <span>⏱ Duration: <b className="text-foreground">{formatDuration(runDetail.durationMs)}</b></span>
                    <span>📝 Files: <b className="text-foreground">{runDetail.files}</b></span>
                    {runDetail.agents > 0 && (
                      <span>🤖 Agents: <b className="text-foreground">{runDetail.done}/{runDetail.agents} done{runDetail.failed > 0 ? `, ${runDetail.failed} failed` : ''}</b> · army run</span>
                    )}
                    {(runDetail.tokensIn > 0 || runDetail.tokensOut > 0) && (
                      <span>🔢 Tokens: <b className="text-foreground">{runDetail.tokensIn}/{runDetail.tokensOut}</b></span>
                    )}
                    {runDetail.provider && <span>🔑 Provider: <b className="text-foreground">{runDetail.provider}</b></span>}
                    {runDetail.model && <span>🧠 Model: <b className="text-foreground">{runDetail.model}</b></span>}
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Task</div>
                    <div className="whitespace-pre-wrap bg-muted/40 rounded-lg p-2 text-xs max-h-40 overflow-y-auto">{runDetail.fullPrompt || runDetail.prompt}</div>
                  </div>
                  {runDetail.response && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Result summary (stored with the run)</div>
                      <div className="whitespace-pre-wrap bg-muted/40 rounded-lg p-2 text-xs max-h-56 overflow-y-auto">{runDetail.response}</div>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-border/60">
                  <Button variant="outline" size="sm" onClick={() => setRunDetail(null)}>Close</Button>
                  <Button
                    size="sm"
                    disabled={running}
                    title={runDetail.agents > 0 ? 'Opens the Army panel with this task pre-filled' : 'Puts this task back into the input box'}
                    onClick={() => {
                      const task = runDetail.fullPrompt || runDetail.prompt
                      if (runDetail.agents > 0) {
                        useAppStore.getState().setMultiAgentPrompt(task)
                        useAppStore.getState().setMultiAgentOpen(true)
                        setRunDetail(null)
                      } else {
                        setPrompt(task)
                        setRunDetail(null)
                      }
                    }}
                  >
                    ▶ Run again
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function MessageBubble({ msg, foldKey, folded, onToggleFold }: {
  msg: AgentMessage
  foldKey?: string
  folded?: boolean
  onToggleFold?: (key: string, next: boolean) => void
}) {
  if (msg.role === 'user') {
    return (
      <div className="flex gap-2 justify-end">
        <div className="bg-primary/15 border border-primary/30 rounded-lg px-3 py-1.5 text-sm max-w-[80%]">
          {msg.content}
        </div>
        <div className="w-6 h-6 rounded-full bg-primary/20 grid place-items-center shrink-0">
          <User className="w-3.5 h-3.5 text-primary" />
        </div>
      </div>
    )
  }
  if (msg.role === 'tool') {
    const result = msg.toolResult
    const hasArgs = !!(msg.toolArgs && Object.keys(msg.toolArgs).length > 0)
    const hasWalls = hasArgs || !!result?.output || !!result?.error
    return (
      <div className="flex gap-2">
        <div className="w-6 h-6 rounded-full bg-accent/20 grid place-items-center shrink-0 mt-0.5">
          <Wrench className="w-3.5 h-3.5 text-accent" />
        </div>
        <div className="flex-1 min-w-0 text-xs">
          <div className="flex items-center gap-2">
            <code className="bg-accent/15 text-accent px-1.5 py-0.5 rounded font-mono">{msg.toolName}</code>
            {msg.pending && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
            {!msg.pending && result?.ok && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
            {!msg.pending && !result?.ok && <XCircle className="w-3.5 h-3.5 text-red-500" />}
            {msg.requiresConfirmation && <Badge variant="outline" className="text-[10px] py-0 h-4 ca-bg-building ca-status-building"><AlertTriangle className="w-2.5 h-2.5 mr-1" />destructive</Badge>}
            {/* v51: per-payload collapse with memory — the choice survives reloads */}
            {foldKey && hasWalls && (
              <button
                className="ml-auto flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground shrink-0"
                onClick={() => onToggleFold?.(foldKey, !folded)}
                title={folded ? 'Expand this tool wall' : 'Collapse this tool wall (remembered for next time)'}
              >
                {folded ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                {folded ? 'show' : 'hide'}
              </button>
            )}
          </div>
          {!folded && (
            <>
              {msg.toolArgs && Object.keys(msg.toolArgs).length > 0 && (
                <pre className="mt-1 p-1.5 bg-muted/40 rounded text-[10px] font-mono whitespace-pre-wrap break-all">
                  {JSON.stringify(msg.toolArgs, null, 2)}
                </pre>
              )}
              {result?.output && (
                <pre className="mt-1 p-1.5 bg-muted/40 rounded text-[10px] font-mono whitespace-pre-wrap break-all text-muted-foreground max-h-32 overflow-y-auto">
                  {result.output.slice(0, 30000)}
                </pre>
              )}
              {result?.error && (
                <pre className="mt-1 p-1.5 bg-red-500/10 rounded text-[10px] font-mono whitespace-pre-wrap break-all text-red-400">
                  {result.error.slice(0, 30000)}
                </pre>
              )}
            </>
          )}
        </div>
      </div>
    )
  }
  // Assistant
  return (
    <div className="flex gap-2">
      <div className="w-6 h-6 rounded-full bg-primary/20 grid place-items-center shrink-0 mt-0.5">
        <Bot className="w-3.5 h-3.5 text-primary" />
      </div>
      <div className={`flex-1 min-w-0 text-sm ${msg.error ? 'text-red-400' : ''}`}>
        <div className="prose prose-invert prose-sm max-w-none">
          <FormattedContent text={msg.content} />
          {msg.pending && <span className="inline-block w-1 h-3 bg-primary ml-0.5 animate-pulse" />}
        </div>
        {/* Speaker button — reads the assistant message aloud using Web Speech API */}
        {!msg.pending && msg.content && !msg.error && (
          <div className="mt-1 flex items-center gap-1">
            <SpeakerButton text={msg.content} />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Speaker button — uses the browser's built-in SpeechSynthesis API to
 * read the text aloud in a natural voice. No external API needed.
 */
function SpeakerButton({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false)
  const [supported, setSupported] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      // Async — avoids sync set-state-in-effect cascading render
      queueMicrotask(() => setSupported(false))
    }
    // Stop speaking when component unmounts
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  function toggleSpeak() {
    if (!supported) {
      toast.error('Text-to-speech not supported in this browser')
      return
    }
    if (speaking) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
      return
    }
    // Strip markdown/code blocks for cleaner speech
    const cleanText = text
      .replace(/```[\s\S]*?```/g, ' (code block) ')
      .replace(/`[^`]+`/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/^#+\s+/gm, '')
      .replace(/^\s*[-*]\s+/gm, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\s+/g, ' ')
      .trim()

    if (!cleanText) return

    const utterance = new SpeechSynthesisUtterance(cleanText)
    // Try to find a natural-sounding English voice
    const voices = window.speechSynthesis.getVoices()
    const preferredVoice =
      voices.find(v => /natural|enhanced|premium/i.test(v.name)) ||
      voices.find(v => /Google.*US|Google.*UK/i.test(v.name)) ||
      voices.find(v => /en-US|en_GB/i.test(v.lang)) ||
      voices.find(v => v.lang.startsWith('en')) ||
      voices[0]
    if (preferredVoice) {
      utterance.voice = preferredVoice
      utterance.lang = preferredVoice.lang
    } else {
      utterance.lang = 'en-US'
    }
    utterance.rate = 1.0
    utterance.pitch = 1.0
    utterance.volume = 1.0
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)

    window.speechSynthesis.cancel() // Cancel any ongoing speech
    window.speechSynthesis.speak(utterance)
    setSpeaking(true)
  }

  if (!supported) return null

  return (
    <button
      onClick={toggleSpeak}
      className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
        speaking
          ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
          : 'bg-primary/10 text-primary hover:bg-primary/20'
      }`}
      title={speaking ? 'Stop speaking' : 'Read aloud'}
    >
      {speaking ? (
        <>
          <StopCircle className="w-3 h-3" />
          <span>Stop</span>
        </>
      ) : (
        <>
          <Volume2 className="w-3 h-3" />
          <span>Listen</span>
        </>
      )}
    </button>
  )
}

/** Minimal markdown-ish formatter: code blocks, inline code, bold, lists. */
function FormattedContent({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`|\*\*[^*]+\*\*)/g)
  return (
    <div className="space-y-1">
      {parts.map((p, i) => {
        if (p.startsWith('```')) {
          const code = p.replace(/^```[a-z]*\n?/, '').replace(/```$/, '')
          return (
            <pre key={i} className="bg-muted/60 rounded p-2 text-xs font-mono overflow-x-auto">
              <code>{code}</code>
            </pre>
          )
        }
        if (p.startsWith('`') && p.endsWith('`')) {
          return <code key={i} className="bg-muted/60 px-1 py-0.5 rounded text-xs font-mono">{p.slice(1, -1)}</code>
        }
        if (p.startsWith('**') && p.endsWith('**')) {
          return <strong key={i}>{p.slice(2, -2)}</strong>
        }
        return <span key={i} className="whitespace-pre-wrap">{p}</span>
      })}
    </div>
  )
}

/**
 * v51 — SwarmBoard: live per-agent cards driven by the {type:'swarm'}
 * snapshots of src/lib/ai/swarm.ts. Mirrors the engine contract exactly:
 *   phase: planning → assign → build → integrate → done
 *   agent: pending (queued) / building (amber) / done (emerald) / failed (red)
 * agents[0] is the planner/leader (Crown). BOARD_RENDER_CAP keeps a 200-agent
 * flood from melting the DOM — every agent still builds, only the DOM trims.
 */
function SwarmBoard({ board, open, onToggle }: {
  board: SwarmBoardState
  open: boolean
  onToggle: () => void
}) {
  const agents = board.agents || []
  const runningN = agents.filter(a => a.status === 'building').length
  const doneN = agents.filter(a => a.status === 'done').length
  const failedN = agents.filter(a => a.status === 'failed').length
  const fileCount = new Set(agents.flatMap(a => a.files || [])).size
  const visible = agents.slice(0, BOARD_RENDER_CAP)
  const phaseColor =
    board.phase === 'done'
      ? 'text-emerald-500 border-emerald-500/40'
      : board.phase === 'build'
        ? 'text-amber-500 border-amber-500/40'
        : 'text-primary border-primary/40'
  return (
    <div className="border-b border-border bg-muted/10 shrink-0">
      <button
        className="w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-muted/20 transition-colors"
        onClick={onToggle}
        title={open ? 'Collapse the swarm board' : 'Expand the swarm board'}
      >
        <span className="flex items-center gap-2 font-semibold min-w-0">
          <Network className="w-3.5 h-3.5 text-primary shrink-0" />
          <span>Swarm board</span>
          <Badge variant="outline" className={`text-[9px] py-0 h-4 uppercase ${phaseColor}`}>{board.phase}</Badge>
        </span>
        <span className="text-[10px] text-muted-foreground flex items-center gap-1.5 shrink-0">
          <span>{agents.length} agents · {runningN} running · {doneN} done · {failedN} failed · {fileCount} file{fileCount === 1 ? '' : 's'}</span>
          {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-2 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5">
          {visible.map((a, i) => (
            <SwarmAgentCard key={a.id + ':' + i} agent={a} isLeader={i === 0} />
          ))}
          {agents.length > BOARD_RENDER_CAP && (
            <div className="col-span-full text-[10px] text-muted-foreground">
              … and {agents.length - BOARD_RENDER_CAP} more agents — the board shows the first {BOARD_RENDER_CAP}, but EVERY agent still builds.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SwarmAgentCard({ agent, isLeader }: { agent: SwarmBoardAgent; isLeader: boolean }) {
  const status = agent.status
  const borderColor =
    status === 'building' ? 'border-l-amber-500'
      : status === 'done' ? 'border-l-emerald-500'
        : status === 'failed' ? 'border-l-red-500'
          : 'border-l-muted-foreground/30'
  const files = agent.files || []
  return (
    <div className={`border border-border border-l-2 ${borderColor} rounded px-2 py-1.5 bg-card/40 text-[11px] min-w-0`}>
      <div className="flex items-center gap-1.5 min-w-0">
        {isLeader
          ? <span title="Leader — plans and integrates" className="shrink-0 inline-flex"><Crown className="w-3 h-3 text-amber-500" /></span>
          : <Bot className="w-3 h-3 text-muted-foreground shrink-0" />}
        <span className="font-medium truncate" title={agent.name}>{agent.name}</span>
        <span className="text-[10px] text-muted-foreground truncate">{agent.kind}</span>
        <span className="ml-auto flex items-center gap-1 shrink-0">
          {files.length > 0 && (
            <Badge variant="outline" className="text-[9px] py-0 h-3.5 gap-0.5" title={files.slice(0, 12).join('\n')}>
              <FileCode2 className="w-2.5 h-2.5" />{files.length}
            </Badge>
          )}
          {status === 'building' && <Loader2 className="w-3 h-3 animate-spin text-amber-500" />}
          {status === 'done' && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
          {status === 'failed' && <XCircle className="w-3 h-3 text-red-500" />}
          {status === 'pending' && <span className="text-[9px] uppercase text-muted-foreground">queued</span>}
        </span>
      </div>
      {agent.title && <div className="truncate text-muted-foreground mt-0.5" title={agent.title}>{agent.title}</div>}
      {files.length > 0 && (
        <div className="truncate text-[10px] font-mono text-muted-foreground/80 mt-0.5" title={files.join('\n')}>
          {files.slice(0, 3).map(baseName).join(', ')}{files.length > 3 ? ` +${files.length - 3} more` : ''}
        </div>
      )}
      {agent.error && (
        <div className="mt-0.5 text-[10px] text-red-400 break-all" title={agent.error}>
          {agent.error.slice(0, 160)}
        </div>
      )}
    </div>
  )
}
