import { NextRequest, NextResponse } from 'next/server'
import { abortRun, getRun, isValidRunId } from '@/lib/ai/run-buffer'
import { requireProjectAccess } from '@/lib/auth'

/**
 * POST /api/agent/abort  —  body: { runId }
 *
 * The ONLY way to stop an agent run early now. The Stop button calls this
 * alongside its local fetch abort — killing the viewer connection alone no
 * longer stops anything (that is the whole point of Unbreakable Runs).
 *
 * 200 { ok: true, aborted: true }  — abort signal fired
 * 200 { ok: true, aborted: false } — run already finished
 * 404                              — unknown runId
 */
export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { body = {} }
  const { runId } = body || {}
  if (!isValidRunId(runId)) {
    return NextResponse.json({ error: 'runId required' }, { status: 400 })
  }
  const run = getRun(runId)
  if (!run) {
    return NextResponse.json({ error: 'Unknown runId' }, { status: 404 })
  }
  // v138 SECURITY FIX — OWNERSHIP: only the run's project owner (or an
  // admin/collaborator) may abort a run. Previously ANY signed-in user
  // could kill another tenant's build just by guessing a runId.
  if (run.projectId) {
    try { await requireProjectAccess(req, run.projectId) } catch (e: any) {
      if (e instanceof Response) return e as any
      throw e
    }
  }
  if (run.done) {
    return NextResponse.json({ ok: true, aborted: false })
  }
  abortRun(runId)
  return NextResponse.json({ ok: true, aborted: true })
}
