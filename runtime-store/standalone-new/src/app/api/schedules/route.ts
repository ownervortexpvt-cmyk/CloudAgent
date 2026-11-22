import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureScheduler, schedulerStatus, fireScheduleById } from '@/lib/scheduler'
import { requireProjectAccess, requireUser, UNAUTH_RESPONSE } from '@/lib/auth'

/**
 * v58 — ⏰ /api/schedules — CRUD for scheduled army runs.
 *
 * GET    ?projectId=…          → list schedules (newest first) + scheduler status
 * POST   { projectId, prompt, mode, intervalMinutes } → create (interval ≥ 5)
 * PATCH  { id, enabled?, prompt?, intervalMinutes?, mode? } → update;
 *          enabling recomputes nextRunAt from now, disabling nulls it
 * DELETE ?id=…                 → remove the schedule
 *
 * Runs fired by the scheduler go through the REAL run APIs (/api/agent,
 * /api/multi-agent) — this endpoint never fakes or simulates anything.
 */

const MIN_INTERVAL_MINUTES = 5

function nextRunFrom(intervalMinutes: number): Date {
  return new Date(Date.now() + Math.max(MIN_INTERVAL_MINUTES, intervalMinutes) * 60_000)
}

function serialize(s: any) {
  return {
    id: s.id,
    projectId: s.projectId,
    projectName: s.project?.name,
    prompt: s.prompt,
    mode: s.mode,
    intervalMinutes: s.intervalMinutes,
    enabled: s.enabled,
    lastRunAt: s.lastRunAt,
    nextRunAt: s.nextRunAt,
    lastStatus: s.lastStatus,
    lastRunId: s.lastRunId,
    createdAt: s.createdAt,
  }
}

export async function GET(req: NextRequest) {
  ensureScheduler() // first-touch fallback boot (instrumentation also boots it)
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')
  // BUSINESS v2 (hardened): auth is always required; the no-projectId
  // listing is scoped to the caller's own projects (admins see all).
  const user = await requireUser(req).catch(() => null)
  if (!user) return UNAUTH_RESPONSE() as any
  if (projectId) {
    try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  }
  let scopeWhere: any = projectId ? { projectId } : undefined
  if (user.role !== 'admin' && !projectId) {
    const ownIds = (await db.project.findMany({ where: { userId: user.id }, select: { id: true } })).map(pp => pp.id)
    scopeWhere = { projectId: { in: ownIds } }
  }

  const schedules = await db.schedule.findMany({
    where: scopeWhere,
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { project: { select: { name: true } } },
  })

  return NextResponse.json({ ok: true, schedules: schedules.map(serialize), scheduler: schedulerStatus() })
}

export async function POST(req: NextRequest) {
  ensureScheduler()
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })

  const projectId = typeof body.projectId === 'string' ? body.projectId : ''
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  const mode = body.mode === 'swarm' ? 'swarm' : 'single'
  const intervalMinutes = Math.max(MIN_INTERVAL_MINUTES, Math.floor(Number(body.intervalMinutes) || 60))

  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  if (!prompt) return NextResponse.json({ error: 'prompt required — what should the army do?' }, { status: 400 })
  if (Number(body.intervalMinutes) && Number(body.intervalMinutes) < MIN_INTERVAL_MINUTES) {
    return NextResponse.json({ error: `interval too small — minimum is ${MIN_INTERVAL_MINUTES} minutes (protects your keys)` }, { status: 400 })
  }

  // BUSINESS v2 (hardened): only the project owner (or an admin) may schedule.
  try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true } })
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const created = await db.schedule.create({
    data: {
      projectId,
      prompt,
      mode,
      intervalMinutes,
      enabled: body.enabled === false ? false : true,
      nextRunAt: body.enabled === false ? null : nextRunFrom(intervalMinutes),
    },
    include: { project: { select: { name: true } } },
  })

  return NextResponse.json({ ok: true, schedule: serialize(created) })
}

export async function PATCH(req: NextRequest) {
  ensureScheduler()
  const body = await req.json().catch(() => null)
  const id = body && typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const existing = await db.schedule.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'schedule not found' }, { status: 404 })
  // BUSINESS v2 (hardened): only the owner (or an admin) may touch this schedule.
  try { await requireProjectAccess(req, existing.projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }

  /* v59 — ⚡ Run now: fire THIS schedule immediately through the exact same
   * code path the 30s tick uses (fireScheduleById: stamp first, run the
   * real run API, stamp the honest outcome). Fire-and-forget — the run is
   * async, lastStatus shows "⏳ running now…" until the real outcome lands.
   * A paused schedule can be fired by an explicit owner tap but is never
   * silently re-enabled (nextRunAt stays null). */
  if (body.runNow === true) {
    void fireScheduleById(id)
    return NextResponse.json({ ok: true, fired: true, schedule: serialize({ ...existing, lastStatus: '⏳ running now…' }) })
  }

  const data: any = {}
  if (typeof body.prompt === 'string' && body.prompt.trim()) data.prompt = body.prompt.trim()
  if (body.mode === 'swarm' || body.mode === 'single') data.mode = body.mode

  let interval = existing.intervalMinutes
  if (body.intervalMinutes !== undefined) {
    if (Number(body.intervalMinutes) < MIN_INTERVAL_MINUTES) {
      return NextResponse.json({ error: `interval too small — minimum is ${MIN_INTERVAL_MINUTES} minutes` }, { status: 400 })
    }
    interval = Math.max(MIN_INTERVAL_MINUTES, Math.floor(Number(body.intervalMinutes) || interval))
    data.intervalMinutes = interval
  }

  if (typeof body.enabled === 'boolean') {
    data.enabled = body.enabled
    // Honest state machine: enabled → next run scheduled from now;
    // disabled → no next run at all (nothing hidden, nothing fake).
    data.nextRunAt = body.enabled ? nextRunFrom(interval) : null
    if (body.enabled && !body.prompt && body.intervalMinutes === undefined) {
      // plain re-enable — keep lastStatus history untouched
    } else if (body.enabled) {
      data.lastStatus = '⏳ re-enabled — first run scheduled'
    }
  }

  const updated = await db.schedule.update({ where: { id }, data, include: { project: { select: { name: true } } } })
  return NextResponse.json({ ok: true, schedule: serialize(updated) })
}

export async function DELETE(req: NextRequest) {
  ensureScheduler()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const existing = await db.schedule.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'schedule not found' }, { status: 404 })
  // BUSINESS v2 (hardened): only the owner (or an admin) may remove this schedule.
  try { await requireProjectAccess(req, existing.projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }

  await db.schedule.delete({ where: { id } })
  return NextResponse.json({ ok: true, removed: id })
}
