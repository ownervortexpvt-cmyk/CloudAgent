import { NextRequest, NextResponse } from 'next/server'
import { runtimeManager } from '@/lib/runtime'
import { requireProjectAccess } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId')!
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  // BUSINESS v2: verify the caller owns this project (admins exempt).
  if (projectId) {
    try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  }
  // Sync DB status with actual process state (fixes stale 'running' after restart)
  const status = await runtimeManager.syncProjectStatus(projectId)
  return NextResponse.json({ status, logs: runtimeManager.getLogs(projectId) })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { projectId, action, command, timeoutMs } = body || {}
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  // SECURITY FIX: POST had NO ownership check — any signed-in user could
  // start/stop/exec/build in ANOTHER user's project (exec = arbitrary
  // command execution inside someone else's directory). GET was already
  // guarded; now every mutating action is too.
  try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  if (action === 'start') {
    const r = await runtimeManager.start(projectId)
    return NextResponse.json(r)
  }
  if (action === 'stop') {
    await runtimeManager.stop(projectId)
    return NextResponse.json({ ok: true })
  }
  if (action === 'exec') {
    const r = await runtimeManager.execInProject(projectId, command, timeoutMs || 600000)
    return NextResponse.json(r)
  }
  if (action === 'build') {
    const r = await runtimeManager.build(projectId)
    return NextResponse.json(r)
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
