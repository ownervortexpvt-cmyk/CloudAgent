/**
 * ADMIN CONTROL ROOM — Server System (v161). Double-gated.
 *
 * GET → live facts about THE machine that runs Vortex Cloud Agent:
 *   host/cpu/memory/disk (os + fs.statfs), toolchain probes (13 managed),
 *   the Quick Tunnel URL (runtime-store/tunnel-state.json), the Pages
 *   deploy backend (deploy/pages-dist/_worker.js DEFAULT_BACKEND line),
 *   the connected vault provider (r2store.* settings), SQLite size and
 *   next-server process info. Read-only — no mutations.
 */
import { NextRequest, NextResponse } from 'next/server'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { requireAdminUnlocked } from '@/lib/admin-lock'
import { MANAGED_TOOLCHAINS } from '@/lib/toolchains'

const ROOT = '/home/z/my-project'

function diskInfo() {
  try {
    const s = fs.statfsSync('/')
    const total = s.blocks * s.bsize
    const free = s.bavail * s.bsize
    return {
      totalGb: Math.round(total / 1073741824 * 10) / 10,
      freeGb: Math.round(free / 1073741824 * 10) / 10,
      usedPct: Math.round(((total - free) / total) * 100),
    }
  } catch {
    return { totalGb: 0, freeGb: 0, usedPct: 0 }
  }
}

function tunnelInfo() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'runtime-store', 'tunnel-state.json'), 'utf8')
    const j = JSON.parse(raw)
    return { url: j.url || null, pid: j.pid || null, since: j.at || null }
  } catch {
    return { url: null, pid: null, since: null }
  }
}

function deployBackend() {
  try {
    const src = fs.readFileSync(path.join(ROOT, 'deploy', 'pages-dist', '_worker.js'), 'utf8')
    const m = src.match(/const DEFAULT_BACKEND = "([^"]+)"/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

function dbInfo() {
  try {
    const base = process.env.DATABASE_URL?.replace(/^file:/, '') || path.join(ROOT, 'db', 'custom.db')
    const abs = base.startsWith('/') ? base : path.join(ROOT, base)
    const stat = fs.statSync(abs)
    return { sizeMb: Math.round(stat.size / 1048576 * 10) / 10, path: abs }
  } catch {
    return { sizeMb: 0, path: '' }
  }
}

async function vaultInfo() {
  try {
    const { getR2StatusInput } = await import('@/lib/r2store')
    const st = await getR2StatusInput()
    return {
      provider: st.connected ? 'JOY SERVICE' : null,
      connected: st.connected,
      endpoint: st.endpoint || null,
      bucket: st.bucket || null,
      enabled: st.enabled,
      lastBackupAt: st.lastBackupAt,
    }
  } catch {
    return { provider: null, connected: false, endpoint: null, bucket: null, enabled: false, lastBackupAt: null }
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireAdminUnlocked(req)
  } catch (e: any) {
    if (e instanceof Response) return e as any
    throw e
  }

  const load = os.loadavg()
  const totalMem = os.totalmem()
  const freeMem = os.freemem()

  const toolchains = MANAGED_TOOLCHAINS.map((t) => {
    let present = false
    try { present = fs.existsSync(path.join(ROOT, t.probe)) } catch {}
    return { name: t.name, label: t.label, version: t.version, present }
  })

  return NextResponse.json({
    ok: true,
    host: {
      hostname: os.hostname(),
      platform: `${os.platform()} ${os.release()}`,
      arch: os.arch(),
      nodeVersion: process.version,
      uptimeSec: Math.round(os.uptime()),
      nextUptimeSec: Math.round(process.uptime()),
    },
    cpu: { model: (os.cpus()[0]?.model || '').trim(), cores: os.cpus().length, loadAvg: load.map(n => Math.round(n * 100) / 100) },
    mem: { totalMb: Math.round(totalMem / 1048576), freeMb: Math.round(freeMem / 1048576), usedPct: Math.round(((totalMem - freeMem) / totalMem) * 100) },
    disk: diskInfo(),
    toolchains,
    flutter: {
      installed: toolchains.find(t => t.name === 'flutter')?.present || false,
      version: '3.50.0',
    },
    tunnel: tunnelInfo(),
    deploy: { backend: deployBackend() },
    vault: await vaultInfo(),
    db: dbInfo(),
    serverTime: new Date().toISOString(),
  })
}
