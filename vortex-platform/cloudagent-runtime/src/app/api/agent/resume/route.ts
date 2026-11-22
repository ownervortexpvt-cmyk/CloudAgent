import { NextRequest, NextResponse } from 'next/server'
import { getRun, isValidRunId, subscribeRun } from '@/lib/ai/run-buffer'
import { requireProjectAccess } from '@/lib/auth'

/**
 * POST /api/agent/resume  —  body: { runId, from? }
 *
 * Re-join an agent run that is still going (or already finished) after the
 * viewer's connection dropped. Emits the SAME NDJSON shape as /api/agent:
 *
 *   { type: 'resumed', runId, from, total, done }   ← first line, always
 *   …buffered events from index `from`…
 *   …live events until { type: 'done' | 'error' }…
 *
 * Dropping THIS connection is harmless — the run itself continues (see
 * lib/ai/run-buffer). 404 means the run is unknown or its replay window
 * (15 min after completion) expired — the client then falls back to an
 * honest "run no longer in memory" message.
 */
export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { body = {} }
  const { runId, from } = body || {}
  if (!isValidRunId(runId)) {
    return NextResponse.json({ error: 'runId required' }, { status: 400 })
  }
  const run = getRun(runId)
  if (!run) {
    return NextResponse.json({ error: 'This run is no longer in memory (finished more than 15 minutes ago or the server restarted).' }, { status: 404 })
  }
  // v138 SECURITY FIX — OWNERSHIP: replaying a run streams its full code
  // and tool results, so only the run's project owner (or an admin) may
  // re-join it. Previously any signed-in user could read another tenant's
  // entire build stream with a guessed runId.
  if (run.projectId) {
    try { await requireProjectAccess(req, run.projectId) } catch (e: any) {
      if (e instanceof Response) return e as any
      throw e
    }
  }
  const start = Math.max(0, Math.min(Number.isFinite(from) ? Number(from) : 0, run.events.length))

  const encoder = new TextEncoder()
  let clientGone = false
  let unsubscribe: (() => void) | null = null

  const stream = new ReadableStream({
    start(ctrl) {
      const send = (obj: any) => {
        if (clientGone) return
        try { ctrl.enqueue(encoder.encode(JSON.stringify(obj) + '\n')) } catch { clientGone = true }
      }

      send({ type: 'resumed', runId, from: start, total: run.events.length, done: run.done })

      // Replay everything the viewer missed
      for (let i = start; i < run.events.length && !clientGone; i++) send(run.events[i])

      if (run.done || clientGone) {
        if (!clientGone) { try { ctrl.close() } catch {} }
        return
      }

      // Live-tail until the run finishes
      unsubscribe = subscribeRun(runId, (ev) => {
        send(ev)
        if (ev?.type === 'done' || ev?.type === 'error') {
          if (unsubscribe) { unsubscribe(); unsubscribe = null }
          try { ctrl.close() } catch {}
        }
      })

      // Safety: if the caller disappears, stop subscribing (run continues)
      ;(req.signal as any).addEventListener?.('abort', () => {
        clientGone = true
        if (unsubscribe) { unsubscribe(); unsubscribe = null }
        try { ctrl.close() } catch {}
      })
    },
    cancel() {
      clientGone = true
      if (unsubscribe) { unsubscribe(); unsubscribe = null }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
