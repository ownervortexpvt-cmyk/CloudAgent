/**
 * v58 Scheduler — ⏰ scheduled army runs.
 *
 * The user's AI army can now fire itself on a timer: one Schedule row per
 * (project, prompt, mode, interval). A 30s in-process tick checks
 * `nextRunAt <= now` and fires the run through the SAME public code path
 * every normal run uses (POST /api/agent for single runs, POST
 * /api/multi-agent for the full swarm) — no bypass, no fake shortcut. The
 * run itself is the real, unbreakable, key-balanced run the user already
 * knows; it is simply started by the clock instead of a button.
 *
 * Honesty rules:
 *   • a fired schedule stamps lastRunAt/nextRunAt/lastStatus/lastRunId on
 *     the row, so the UI always shows what actually happened
 *   • a fire that fails (server unreachable, project gone) is recorded in
 *     lastStatus — never silently dropped
 *   • intervalMinutes has a floor of 5 minutes (enforced again here)
 *   • the tick survives Next.js dev HMR via globalThis (same pattern as
 *     run-buffer), and is started both from instrumentation (server boot)
 *     and from the /api/schedules route (first touch fallback)
 */

import { createHash, createHmac } from 'crypto'
import { db } from '@/lib/db'

const TICK_MS = 30_000
const MIN_INTERVAL_MINUTES = 5

interface SchedulerState {
  timer: ReturnType<typeof setInterval> | null
  ticking: boolean
  lastTickAt: number
  firedTotal: number
  lastFireError: string | null
  internalToken: string | null
  internalTokenExp: number
}

const g = globalThis as any as { __caScheduler?: SchedulerState }

function state(): SchedulerState {
  if (!g.__caScheduler) {
    g.__caScheduler = { timer: null, ticking: false, lastTickAt: 0, firedTotal: 0, lastFireError: null, internalToken: null, internalTokenExp: 0 }
  }
  return g.__caScheduler
}

/**
 * The lock middleware (src/middleware.ts) guards EVERY API route — the
 * scheduler's internal run calls are no exception, and they should NOT be:
 * no security bypasses. Instead the scheduler authenticates EXACTLY like
 * the owner's browser does: it signs a proper v1 token with the stored
 * lock_secret (server-side secret the app itself owns), registers a real
 * revocable LockSession row ("⏰ Scheduler (internal)" visible in
 * Settings → Security), and sends the x-ca-lock header. If the owner
 * revokes sessions, the scheduler simply mints a fresh one — same trust
 * level as the server process itself.
 */
async function internalAuthHeaders(): Promise<Record<string, string>> {
  const s = state()
  if (s.internalToken && s.internalTokenExp > Date.now() + 60_000) {
    return { 'x-ca-lock': s.internalToken }
  }
  try {
    const secretRow = await db.userSetting.findUnique({ where: { key: 'lock_secret' } })
    if (!secretRow?.value) {
      s.lastFireError = 'internal auth: lock_secret not found in DB — firing without header'
      return {}
    }
    const exp = Date.now() + 24 * 3600 * 1000
    const mac = createHmac('sha256', secretRow.value).update(`v1.${exp}`).digest('hex')
    const token = `v1.${exp}.${mac}`
    const tokenHash = createHash('sha256').update(token).digest('hex')
    try {
      await db.lockSession.upsert({
        where: { tokenHash },
        update: { lastSeenAt: new Date() },
        create: { tokenHash, device: '⏰ Scheduler (internal)', ip: '127.0.0.1' },
      })
    } catch (e: any) {
      s.lastFireError = `internal auth session upsert failed: ${String(e?.message || e).slice(0, 160)}`
    }
    s.internalToken = token
    s.internalTokenExp = exp
    return { 'x-ca-lock': token }
  } catch (e: any) {
    s.lastFireError = `internal auth failed: ${String(e?.message || e).slice(0, 160)}`
    return {}
  }
}

/** Drain an NDJSON event stream to completion, mining it for the runId and
 *  the final outcome. Cheap on purpose — we only need the truth stamps. */
async function drainRunStream(res: Response, onEvent: (evt: any) => void): Promise<void> {
  const body = res.body
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (!line) continue
        try {
          onEvent(JSON.parse(line))
        } catch {}
      }
    }
  } finally {
    try {
      await reader.cancel()
    } catch {}
  }
}

/**
 * POST a run API with scheduler self-auth. If the cached internal token was
 * revoked or the lock secret rotated (e.g. by an owner recovery), one 401
 * triggers a FRESH mint + one retry — the scheduler re-authenticates like
 * any honest client instead of failing silently.
 */
async function fetchRunApi(url: string, body: any): Promise<Response> {
  let headers = await internalAuthHeaders()
  let res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  if (res.status === 401) {
    const s = state()
    s.internalToken = null
    s.internalTokenExp = 0
    headers = await internalAuthHeaders()
    if (Object.keys(headers).length > 0) {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      })
    }
  }
  return res
}

async function fireSingle(baseUrl: string, schedule: { id: string; projectId: string; prompt: string }): Promise<{ runId: string | null; outcome: string }> {
  let runId: string | null = null
  let outcome = '✅ finished'
  try {
    // forceBuiltIn: /api/agent runs the FULL SWARM by default whenever a key
    // pool exists — a "one agent (cheap, 1 call)" schedule must be honest, so
    // we pin the built-in Vortex Engine provider and the SINGLE-agent path. The run is
    // the real unbreakable run, exactly 1 LLM call, persisted in 🕘 history.
    const res = await fetchRunApi(`${baseUrl}/api/agent`, { projectId: schedule.projectId, prompt: schedule.prompt, forceBuiltIn: true })
    if (!res.ok) {
      const text = (await res.text().catch(() => '')) || ''
      return { runId: null, outcome: `❌ HTTP ${res.status} ${text.slice(0, 120)}` }
    }
    await drainRunStream(res, (evt) => {
      if (evt?.runId && !runId) runId = evt.runId
      if (evt?.type === 'done') outcome = evt.ok === false ? '❌ failed (see 🕘 history)' : '✅ finished'
      if (evt?.type === 'error' || evt?.type === 'failed') outcome = '❌ failed (see 🕘 history)'
    })
  } catch (e: any) {
    return { runId, outcome: `❌ ${String(e?.message || e).slice(0, 120)}` }
  }
  return { runId, outcome }
}

async function fireSwarm(baseUrl: string, schedule: { id: string; projectId: string; prompt: string }): Promise<{ runId: string | null; outcome: string }> {
  let runId: string | null = null
  let outcome = '✅ finished'
  try {
    const res = await fetchRunApi(`${baseUrl}/api/multi-agent`, { action: 'start', projectId: schedule.projectId, task: schedule.prompt })
    if (!res.ok) {
      const text = (await res.text().catch(() => '')) || ''
      return { runId: null, outcome: `❌ HTTP ${res.status} ${text.slice(0, 120)}` }
    }
    await drainRunStream(res, (evt) => {
      if (evt?.runId && !runId) runId = evt.runId
      if (evt?.type === 'done' || evt?.type === 'complete') outcome = '✅ finished'
      if (evt?.type === 'error') outcome = '❌ failed (see 🕘 history)'
    })
  } catch (e: any) {
    return { runId, outcome: `❌ ${String(e?.message || e).slice(0, 120)}` }
  }
  return { runId, outcome }
}

/**
 * v59 — fire ONE schedule right now, by id. This is the exact same code
 * path the 30s tick uses (stamp first → fire the REAL run API → stamp the
 * honest outcome), extracted so the /api/schedules PATCH { runNow: true }
 * "⚡ Run now" button can trigger an immediate fire.
 *
 * Honesty rules preserved:
 *   • stamps lastRunAt/lastStatus BEFORE firing (a crash can't loop)
 *   • a disabled (paused) schedule CAN be fired by an explicit owner tap,
 *     but its nextRunAt stays null — run-now never re-enables silently
 *   • enabled schedules get nextRunAt = now + interval, like the tick
 */
export async function fireScheduleById(id: string): Promise<void> {
  const s = state()
  let sched: { id: string; projectId: string; prompt: string; mode: string; intervalMinutes: number; enabled: boolean } | null = null
  try {
    const row = await db.schedule.findUnique({
      where: { id },
      include: { project: { select: { id: true } } },
    })
    if (!row) return
    if (!row.project) {
      await db.schedule.update({ where: { id }, data: { enabled: false, lastStatus: '❌ project not found — schedule disabled' } })
      return
    }
    sched = { id: row.id, projectId: row.projectId, prompt: row.prompt, mode: row.mode, intervalMinutes: row.intervalMinutes, enabled: row.enabled }
  } catch (e: any) {
    s.lastFireError = `${id}: ${String(e?.message || e).slice(0, 120)}`
    return
  }

  const interval = Math.max(MIN_INTERVAL_MINUTES, sched.intervalMinutes)
  const now = new Date()
  // Stamp FIRST so a fire that crashes cannot loop infinitely. A paused
  // schedule keeps nextRunAt null — "Run now" is a one-shot tap, not a
  // silent re-enable.
  try {
    await db.schedule.update({
      where: { id },
      data: {
        lastRunAt: now,
        nextRunAt: sched.enabled ? new Date(now.getTime() + interval * 60_000) : null,
        lastStatus: '⏳ running now…',
      },
    })
  } catch (e: any) {
    s.lastFireError = `${id}: stamp failed: ${String(e?.message || e).slice(0, 120)}`
    return
  }
  s.firedTotal++
  const baseUrl = `http://127.0.0.1:${process.env.PORT || 3000}`
  const payload = { id: sched.id, projectId: sched.projectId, prompt: sched.prompt }
  const fire = sched.mode === 'swarm' ? fireSwarm : fireSingle
  void fire(baseUrl, payload)
    .then(async ({ runId, outcome }) => {
      await db.schedule.update({
        where: { id },
        data: { lastStatus: outcome, lastRunId: runId ?? undefined },
      })
      if (outcome.startsWith('❌')) s.lastFireError = `${sched!.id}: ${outcome}`
    })
    .catch(async (e) => {
      s.lastFireError = `${sched!.id}: ${String(e?.message || e).slice(0, 120)}`
      await db.schedule
        .update({ where: { id }, data: { lastStatus: `❌ ${String(e?.message || e).slice(0, 120)}` } })
        .catch(() => {})
    })
}

async function tick(): Promise<void> {
  const s = state()
  if (s.ticking) return
  s.ticking = true
  s.lastTickAt = Date.now()
  try {
    const due = await db.schedule.findMany({
      where: { enabled: true, nextRunAt: { lte: new Date() } },
      select: { id: true },
    })
    for (const sched of due) {
      // v59: the full fire flow lives in fireScheduleById — the tick simply
      // calls it per due schedule (same code path as the ⚡ Run now button)
      void fireScheduleById(sched.id)
    }
  } catch (e: any) {
    s.lastFireError = String(e?.message || e).slice(0, 200)
  } finally {
    s.ticking = false
  }

  // v111: local open-source AI runtime watchdog — keep the zero-API-key
  // model server (Ollama / llama.cpp on :11434) alive. Cheap when up:
  // one ~1s localhost probe per tick; spawns only when down (rate-limited).
  try {
    const { ensureLocalRuntime } = await import('@/lib/ai/local-runtime')
    await ensureLocalRuntime()
  } catch { /* never let the watchdog break the scheduler */ }
}

/** Idempotent boot — safe to call from multiple modules (HMR-safe). */
export function ensureScheduler(): void {
  const s = state()
  if (s.timer) return
  s.timer = setInterval(() => void tick(), TICK_MS)
  // Do not hold the event loop open in dev — unref keeps shutdown clean
  const t = s.timer as unknown as { unref?: () => void }
  if (typeof t.unref === 'function') t.unref()
  // First tick shortly after boot (not synchronously — DB may not be warm)
  setTimeout(() => void tick(), 5_000).unref?.()
}

export function schedulerStatus() {
  const s = state()
  return {
    running: Boolean(s.timer),
    lastTickAt: s.lastTickAt,
    firedTotal: s.firedTotal,
    lastFireError: s.lastFireError,
    tickMs: TICK_MS,
  }
}
