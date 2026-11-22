/**
 * v149 — CLOUDAGENT SELF-UPDATE (the owner's #1 ask: "এই ক্লাউড এজেন্ট এর
 * নিজের বিল্ড আপডেট করব").
 *
 * GET  → live status: current build id + serving mode (dev/prod), last/running
 *        self-update job (phase polling), tail of the job log.
 * POST {action:'start'} → spawn the detached self-update pipeline
 *        (scripts/self-update.sh): install → build --webpack → verify →
 *        swap :3000 to the fresh production build → verify live; ANY failure
 *        falls back to the dev server so the platform never stays down.
 *        One job at a time (pidfile lock in the script).
 *
 * Double-gated: admin session AND control-room PIN (requireAdminUnlocked).
 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { requireAdminUnlocked } from '@/lib/admin-lock'

const BASE = process.env.PROJECT_ROOT || '/home/z/my-project'
const STATE = path.join(BASE, 'db', 'selfupdate-state.json')
const LOG = path.join(BASE, 'db', 'selfupdate.log')
const LOCK = path.join(BASE, 'db', 'selfupdate.lock')

interface UpdateState {
  phase: string
  error: string
  note: string
  buildId: string
  oldBuildId: string
  updatedAt: string
}

function readState(): UpdateState | null {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) as UpdateState } catch { return null }
}

function currentBuildId(): string {
  try { return fs.readFileSync(path.join(BASE, '.next', 'BUILD_ID'), 'utf8').trim() } catch { return 'dev' }
}

function jobRunning(): { running: boolean; pid?: number } {
  try {
    const pid = Number(fs.readFileSync(LOCK, 'utf8').trim())
    if (pid > 0) process.kill(pid, 0) // throws when dead
    return { running: true, pid }
  } catch { return { running: false } }
}

function tailLog(lines = 25): string {
  try {
    return fs.readFileSync(LOG, 'utf8').split('\n').slice(-lines).join('\n')
  } catch { return '' }
}

export async function GET(req: NextRequest) {
  try {
    await requireAdminUnlocked(req)
  } catch (e: any) {
    if (e instanceof Response) return e as any
    throw e
  }
  const buildId = currentBuildId()
  const job = jobRunning()
  const st = readState()
  return NextResponse.json({
    ok: true,
    current: { buildId, mode: buildId === 'dev' ? 'dev' : 'production' },
    job: {
      running: job.running,
      pid: job.pid || null,
      // a job is "live" if a pidfile exists AND the state phase is not terminal
      phase: st?.phase || null,
      error: st?.error || '',
      note: st?.note || '',
      buildId: st?.buildId || null,
      oldBuildId: st?.oldBuildId || null,
      updatedAt: st?.updatedAt || null,
      finished: Boolean(st) && !job.running && ['done', 'failed'].includes(st!.phase),
    },
    logTail: tailLog(),
  })
}

export async function POST(req: NextRequest) {
  try {
    await requireAdminUnlocked(req)
  } catch (e: any) {
    if (e instanceof Response) return e as any
    throw e
  }
  const body = await req.json().catch(() => ({}))
  const action = String(body?.action || '')

  if (action !== 'start') {
    return NextResponse.json({ ok: false, error: `unknown action: ${action || '(none)'}. Use 'start'.` }, { status: 400 })
  }

  if (jobRunning().running) {
    return NextResponse.json({ ok: false, error: 'A self-update job is already running — poll GET /api/admin/self-update for progress.' }, { status: 409 })
  }

  // RAM guard: a webpack build needs headroom; this is a 4GB box.
  try {
    const { execSync } = await import('child_process')
    const availMB = Number(execSync("free -m | awk '/^Mem:/{print $7}'").toString().trim())
    if (Number.isFinite(availMB) && availMB < 700) {
      return NextResponse.json({
        ok: false,
        error: `Not enough free RAM right now (${availMB}MB available, ~700MB needed for the build). Close heavy runs and retry.`,
      }, { status: 503 })
    }
  } catch { /* free unavailable — allow */ }

  const { spawn } = await import('child_process')
  const child = spawn('setsid', ['nohup', 'bash', path.join(BASE, 'scripts', 'self-update.sh')], {
    cwd: BASE,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PATH: `${BASE}/node_modules/.bin:${process.env.PATH || ''}` },
  })
  child.unref()

  // give the pidfile a moment to appear so the response is honest
  await new Promise((r) => setTimeout(r, 800))
  const running = jobRunning()
  return NextResponse.json({
    ok: true,
    started: true,
    pid: running.pid || child.pid,
    note: 'Self-update started: install → build (webpack) → swap :3000 to the new production build. The site goes briefly offline during the build (~2-4 min); any failure auto-falls-back to the dev server. Poll GET for progress.',
  })
}
