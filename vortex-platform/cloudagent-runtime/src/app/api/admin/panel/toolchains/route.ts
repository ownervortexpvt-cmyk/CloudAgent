/**
 * ADMIN CONTROL ROOM — toolchain installer (v113). Double-gated.
 *
 * GET  → install-log tails for toolchains that have one
 * POST { name } → start `bash scripts/<setup>.sh` DETACHED (resumable
 *                 scripts; the log file is polled by the panel).
 *
 * Only the names in MANAGED_TOOLCHAINS are accepted — no arbitrary command
 * execution. A second POST for an already-running install is a no-op.
 */
import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { requireAdminUnlocked } from '@/lib/admin-lock'
import { toolchainByName } from '@/lib/toolchains'

const LOG_DIR = path.join(process.cwd(), 'sdk')

function logPath(name: string) {
  return path.join(LOG_DIR, `.install-${name}.log`)
}

export async function GET(req: NextRequest) {
  try {
    await requireAdminUnlocked(req)
  } catch (e: any) {
    if (e instanceof Response) return e as any
    throw e
  }
  const logs: Record<string, { tail: string; running: boolean; bytes: number }> = {}
  try {
    for (const f of fs.readdirSync(LOG_DIR)) {
      const m = f.match(/^\.install-(.+)\.log$/)
      if (!m) continue
      const full = path.join(LOG_DIR, f)
      const stat = fs.statSync(full)
      const recent = Date.now() - stat.mtimeMs < 5 * 60 * 1000 // touched in the last 5 min → likely running
      const buf = fs.readFileSync(full)
      logs[m[1]] = { tail: buf.slice(-8000).toString('utf8'), running: recent, bytes: stat.size }
    }
  } catch {}
  return NextResponse.json({ ok: true, logs })
}

export async function POST(req: NextRequest) {
  try {
    await requireAdminUnlocked(req)
  } catch (e: any) {
    if (e instanceof Response) return e as any
    throw e
  }

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }
  const name = String(body?.name || '')
  const tc = toolchainByName(name)
  if (!tc) return NextResponse.json({ ok: false, error: `unknown toolchain: ${name}` }, { status: 404 })

  const script = path.join(process.cwd(), 'scripts', tc.setup)
  if (!fs.existsSync(script)) {
    return NextResponse.json({ ok: false, error: `setup script missing: scripts/${tc.setup}` }, { status: 500 })
  }

  const lp = logPath(name)
  // Already running? (log touched in the last 2 min)
  try {
    const stat = fs.statSync(lp)
    if (Date.now() - stat.mtimeMs < 2 * 60 * 1000) {
      return NextResponse.json({ ok: true, alreadyRunning: true, log: `.install-${name}.log` }, { status: 202 })
    }
  } catch {}

  const out = fs.openSync(lp, 'a')
  fs.writeSync(out, `\n===== install started ${new Date().toISOString()} =====\n`)
  const child = spawn('bash', [script], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, NONINTERACTIVE: '1', CI: '1' },
  })
  child.unref()
  fs.closeSync(out)

  return NextResponse.json({ ok: true, started: true, name, log: `.install-${name}.log`, approxMb: tc.approxMb }, { status: 202 })
}
