/**
 * Run Buffer — the memory that lets an agent run OUTLIVE its HTTP connection.
 *
 * The problem this solves (Task 31, "Error: network error" on phones):
 *   A Cloud Agent build streams over ONE long POST /api/agent connection.
 *   On a mobile network that connection routinely dies after a few minutes
 *   (carrier NAT timeouts, WiFi↔LTE switch, the OS backgrounding the tab).
 *   Before this module, a dropped connection ALSO aborted the run itself
 *   (req.signal → controller.abort) — the user watched minutes of work die
 *   with a raw "Error: network error" and "(stopped)" tools.
 *
 * Now: every event is teed into an in-memory buffer keyed by a runId.
 *   - The run NEVER aborts because the viewer left. It finishes server-side
 *     no matter what the network does.
 *   - POST /api/agent/resume { runId, from } replays buffered events from
 *     index `from` and then live-tails the rest until `done`.
 *   - POST /api/agent/abort { runId } is the ONLY thing that stops a run
 *     (wired to the Stop button).
 *
 * Buffers are bounded (events per run, runs per process, TTL after done) so
 * a long session cannot leak memory. Survives Next.js dev HMR via globalThis.
 */

export interface BufferedRun {
  id: string
  events: any[]
  /** set true when the run finished (done / error event already buffered) */
  done: boolean
  /** set true via /api/agent/abort — the run's AbortController was fired */
  aborted: boolean
  /** set true once the HTTP viewer detaches (we keep buffering regardless) */
  viewerDetached: boolean
  createdAt: number
  doneAt?: number
  listeners: Set<(ev: any) => void>
  cleanupTimer?: ReturnType<typeof setTimeout>
  /** wired by the run route so /api/agent/abort can fire the controller */
  abortFn?: () => void
  /** v138 SECURITY FIX — ownership tag wired by /api/agent and
   *  /api/multi-agent right after registerRun(). abort/resume use it to
   *  verify the caller actually owns this run (admins exempt). Runs from
   *  before a restart are gone from memory anyway, so every live run has
   *  the tag. */
  projectId?: string
  userId?: string
}

const MAX_EVENTS_PER_RUN = 8_000
const MAX_RUNS = 60
const DONE_TTL_MS = 15 * 60 * 1000 // keep finished runs replayable for 15 min

// globalThis — survive Next.js dev-server HMR module reloads
const g = globalThis as any
if (!g.__caRunBuffers) g.__caRunBuffers = new Map<string, BufferedRun>()
const runs: Map<string, BufferedRun> = g.__caRunBuffers

export function isValidRunId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(id)
}

/** Create (or idempotently reuse) the buffer for a run id. */
export function registerRun(id: string): BufferedRun {
  const existing = runs.get(id)
  if (existing) return existing
  // Evict the oldest finished runs when the registry is full
  if (runs.size >= MAX_RUNS) {
    const entries = [...runs.entries()]
      .filter(([, r]) => r.done)
      .sort((a, b) => (a[1].doneAt || 0) - (b[1].doneAt || 0))
    for (let i = 0; i < Math.min(5, entries.length); i++) disposeRun(entries[i][0])
  }
  const run: BufferedRun = {
    id,
    events: [],
    done: false,
    aborted: false,
    viewerDetached: false,
    createdAt: Date.now(),
    listeners: new Set(),
  }
  runs.set(id, run)
  return run
}

export function getRun(id: string): BufferedRun | undefined {
  return runs.get(id)
}

/** Tee one event into the buffer and fan it out to live subscribers. */
export function pushEvent(id: string, ev: any): void {
  const run = runs.get(id)
  if (!run) return
  if (run.events.length < MAX_EVENTS_PER_RUN) {
    run.events.push(ev)
  } else if (run.events.length === MAX_EVENTS_PER_RUN) {
    // Hard cap reached — keep the stream truthful instead of silently lying
    run.events.push({ type: 'message', content: '⚠ Event log truncated (very long run) — the run itself continued normally.' })
  }
  for (const fn of run.listeners) {
    try { fn(ev) } catch {}
  }
  if (ev?.type === 'done' || ev?.type === 'error') finishRun(id)
}

/** Subscribe to live events. Returns the unsubscribe function. */
export function subscribeRun(id: string, fn: (ev: any) => void): () => void {
  const run = runs.get(id)
  if (!run) return () => {}
  run.listeners.add(fn)
  return () => { run.listeners.delete(fn) }
}

/** Mark a viewer detached — the run itself is NOT touched. */
export function detachViewer(id: string): void {
  const run = runs.get(id)
  if (run) run.viewerDetached = true
}

/** Mark the run finished and schedule replay-window cleanup. */
export function finishRun(id: string): void {
  const run = runs.get(id)
  if (!run || run.done) return
  run.done = true
  run.doneAt = Date.now()
  // Live listeners may still exist (an attached viewer finishing normally);
  // they unsubscribe themselves when their stream loop exits.
  if (run.cleanupTimer) clearTimeout(run.cleanupTimer)
  run.cleanupTimer = setTimeout(() => disposeRun(id), DONE_TTL_MS)
  if (typeof run.cleanupTimer === 'object' && run.cleanupTimer && 'unref' in run.cleanupTimer) {
    try { (run.cleanupTimer as any).unref() } catch {}
  }
}

/** The ONLY way a run stops early: an explicit abort from the owner. */
export function abortRun(id: string): boolean {
  const run = runs.get(id)
  if (!run) return false
  run.aborted = true
  run.abortFn?.()
  return true
}

/** Wire the run's AbortController so /api/agent/abort can fire it. */
export function setAbortFn(id: string, fn: () => void): void {
  const run = runs.get(id)
  if (run) (run as any).abortFn = fn
}

function disposeRun(id: string): void {
  const run = runs.get(id)
  if (!run) return
  if (run.cleanupTimer) clearTimeout(run.cleanupTimer)
  run.listeners.clear()
  run.events.length = 0
  runs.delete(id)
}
