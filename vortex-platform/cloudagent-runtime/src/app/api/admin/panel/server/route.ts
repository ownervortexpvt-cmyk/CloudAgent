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

  // v164.9 — TOOLCHAIN PROBES MUST NEVER BLOCK THE EVENT LOOP: the probes
  // stat files under sdk/ → ossfs (FUSE). One sync existsSync on a congested
  // FUSE mount froze the ENTIRE server (all routes + :3000 dead while the
  // process lived) whenever the owner's admin panel polled this endpoint.
  // Probes now run in a detached child process (worst case: the child hangs,
  // the server never does) with a 60s module-level cache.
  const g = globalThis as any
  const now = Date.now()
  if (!g.__vortexTcProbe || now - g.__vortexTcProbe.at > 60_000) {
    g.__vortexTcProbe = { at: now, data: null as null | Array<{ name: string; label: string; version: string; present: boolean }>, pending: false }
  }
  let toolchains = g.__vortexTcProbe.data
  if (!toolchains && !g.__vortexTcProbe.pending) {
    g.__vortexTcProbe.pending = true
    try {
      const { execFile } = await import('child_process')
      const probeScript = MANAGED_TOOLCHAINS.map((t) =>
        `if [ -e "${path.join(ROOT, t.probe)}" ]; then echo "${t.name}|1"; else echo "${t.name}|0"; fi`,
      ).join('\n')
      const out = await new Promise<string>((resolve) => {
        execFile('bash', ['-c', probeScript], { timeout: 30_000 }, (err, stdout) => resolve(String(stdout || '')))
      })
      const presentMap = new Map(out.split('\n').filter(Boolean).map((l) => [l.split('|')[0], l.split('|')[1] === '1']))
      toolchains = MANAGED_TOOLCHAINS.map((t) => ({ name: t.name, label: t.label, version: t.version, present: presentMap.get(t.name) === true }))
      g.__vortexTcProbe.data = toolchains
    } catch {}
    g.__vortexTcProbe.pending = false
  }
  if (!toolchains) {
    // First poll after boot: return honest "probing" state, never block.
    toolchains = MANAGED_TOOLCHAINS.map((t) => ({ name: t.name, label: t.label, version: t.version, present: false }))
  }

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
