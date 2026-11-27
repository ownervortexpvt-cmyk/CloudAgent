import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { MANAGED_TOOLCHAINS } from '@/lib/toolchains'

/**
 * v79 — SDK Manager API.
 *
 * GET    /api/sdks            → managed-toolchain status + storage + custom SDKs
 * POST   /api/sdks            → install a CUSTOM SDK binary from an operator URL
 * DELETE /api/sdks?name=x     → remove a custom SDK
 *
 * "Permanently saved": everything lands inside /home/z/my-project/sdk/ (the
 * persistent path). If a sandbox snapshot restore wipes it, the sdk-doctor
 * auto-heal on server boot restores all 13 managed toolchains by itself, and
 * the custom SDKs can be re-installed in one click from this panel.
 *
 * v81: the managed registry moved to lib/toolchains.ts so the Add-Storage
 * provisioning engine shares one source of truth.
 */

const SDK_ROOT = '/home/z/my-project/sdk'
const CUSTOM_ROOT = path.join(SDK_ROOT, 'custom')
const BASE = '/home/z/my-project'

/** The 13 managed toolchains (registry with probe/version/setup/approxMb in
 *  lib/toolchains.ts; existence is probed LIVE — fast stat calls). */
const MANAGED = MANAGED_TOOLCHAINS

function readCustomSdks() {
  const out: { name: string; status: string; log: string; installedAt?: string; sizeMb?: number }[] = []
  try {
    if (!fs.existsSync(CUSTOM_ROOT)) return out
    for (const d of fs.readdirSync(CUSTOM_ROOT)) {
      if (d.startsWith('.')) continue
      const dir = path.join(CUSTOM_ROOT, d)
      if (!fs.statSync(dir).isDirectory()) continue
      const statusFile = path.join(dir, '.install-status')
      const logFile = path.join(dir, '.install-log')
      let status = 'ok'
      try { status = fs.readFileSync(statusFile, 'utf8').trim() } catch {
        // no status file yet → either installing or a pre-v79 dir with content
        const hasMeta = fs.existsSync(path.join(dir, '.sdk-meta.json'))
        const entries = fs.readdirSync(dir).filter(x => !x.startsWith('.'))
        status = hasMeta || entries.length > 0 ? 'ok' : 'installing'
      }
      let log = ''
      try { log = fs.readFileSync(logFile, 'utf8').split('\n').slice(-8).join('\n') } catch {}
      let installedAt: string | undefined
      try { installedAt = JSON.parse(fs.readFileSync(path.join(dir, '.sdk-meta.json'), 'utf8')).installedAt } catch {}
      out.push({ name: d, status, log, installedAt, sizeMb: dirSizeMb(dir) })
    }
  } catch {}
  return out
}

function dirSizeMb(dir: string): number {
  let total = 0
  try {
    const walk = (d: string, depth: number) => {
      if (depth > 4) return
      for (const e of fs.readdirSync(d)) {
        const p = path.join(d, e)
        try {
          const st = fs.lstatSync(p)
          if (st.isDirectory()) walk(p, depth + 1)
          else if (st.isFile()) total += st.size
        } catch {}
      }
    }
    walk(dir, 0)
  } catch {}
  return Math.round(total / 1048576)
}

function storage() {
  try {
    const st = fs.statfsSync('/')
    const total = st.blocks * st.bsize
    const free = st.bavail * st.bsize
    return {
      totalGb: Math.round(total / 1073741824 * 10) / 10,
      usedGb: Math.round((total - free) / 1073741824 * 10) / 10,
      freeGb: Math.round(free / 1073741824 * 10) / 10,
      usedPct: Math.round((1 - free / total) * 100),
      // honest platform note: this sandbox's quota is fixed by the platform
      limit: 'platform-fixed 9.9 GB sandbox volume',
    }
  } catch (e: any) {
    return { totalGb: 0, usedGb: 0, freeGb: 0, usedPct: 0, limit: 'unknown', error: e?.message }
  }
}

function isDoctorRunning(): boolean {
  try {
    // cheap probe: lock dir younger than 30 min means a run is (very likely) active
    const lock = path.join(BASE, '.sdk-doctor.lock')
    if (!fs.existsSync(lock)) return false
    return Date.now() - fs.statSync(lock).mtimeMs < 30 * 60 * 1000
  } catch { return false }
}

export async function GET(req: NextRequest) {
  // v86: GET ?list=uploads — list installable archives in the platform's
  // added storage (upload mount) so the SDK Manager can offer one-tap
  // installs of the SDKs the owner stored there.
  if (req.nextUrl.searchParams.get('list') === 'uploads') {
    try {
      const UPLOAD_ROOT = '/home/z/my-project/upload'
      if (!fs.existsSync(UPLOAD_ROOT)) return NextResponse.json({ ok: true, uploads: [] })
      const entries = fs.readdirSync(UPLOAD_ROOT, { withFileTypes: true })
      const uploads = entries
        .filter(e => e.isFile())
        .map(e => {
          const full = path.join(UPLOAD_ROOT, e.name)
          let size = 0
          try { size = fs.statSync(full).size } catch {}
          const fmt = /\.tar\.gz$|\.tgz$/.test(e.name) ? 'tar.gz'
            : /\.tar\.bz2$/.test(e.name) ? 'tar.bz2'
            : /\.tar\.xz$/.test(e.name) ? 'tar.xz'
            : /\.zip$/.test(e.name) ? 'zip'
            : 'binary'
          return { name: e.name, path: full, size, format: fmt, installable: fmt !== 'binary' || size < 200 * 1024 * 1024 }
        })
        .sort((a, b) => b.size - a.size)
      return NextResponse.json({ ok: true, uploads })
    } catch (e: any) {
      return NextResponse.json({ error: e?.message }, { status: 500 })
    }
  }
  // v164.9 — probes via detached child + 60s cache: sync existsSync on the
  // ossfs-backed sdk/ froze the whole event loop under FUSE congestion.
  const g = globalThis as any
  let toolchains: any[] = g.__vortexSdkProbe?.data || null
  if (!toolchains && !g.__vortexSdkProbe?.pending) {
    g.__vortexSdkProbe = { ...(g.__vortexSdkProbe || {}), pending: true }
    try {
      const { execFile } = await import('child_process')
      const script = MANAGED.map(m => `if [ -e "${path.join(BASE, m.probe)}" ]; then echo "${m.name}|1"; else echo "${m.name}|0"; fi`).join('\n')
      const out = await new Promise<string>((resolve) => {
        execFile('bash', ['-c', script], { timeout: 30_000 }, (err, stdout) => resolve(String(stdout || '')))
      })
      const pm = new Map(out.split('\n').filter(Boolean).map(l => [l.split('|')[0], l.split('|')[1] === '1']))
      toolchains = MANAGED.map(m => ({ ...m, present: pm.get(m.name) === true }))
      g.__vortexSdkProbe = { at: Date.now(), data: toolchains, pending: false }
    } catch { g.__vortexSdkProbe = { ...(g.__vortexSdkProbe || {}), pending: false } }
  }
  if (!toolchains) toolchains = MANAGED.map(m => ({ ...m, present: false }))
  return NextResponse.json({
    toolchains,
    custom: readCustomSdks(),
    storage: storage(),
    doctor: (() => {
      try {
        const log = fs.readFileSync(path.join(BASE, 'sdk-doctor.log'), 'utf8').split('\n')
        return { running: isDoctorRunning(), lastLines: log.slice(-5).join('\n') }
      } catch { return { running: false, lastLines: '' } }
    })(),
  })
}

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,40}$/
const FORMATS = new Set(['tar.gz', 'tgz', 'tar.bz2', 'tar.xz', 'zip', 'binary'])
// v86: the owner's "added storage" (platform upload mount) — files persisted
// there are the ONLY storage that survives snapshot wipes, so SDK archives
// the owner uploaded can now be installed DIRECTLY from it.
const UPLOAD_ROOT = '/home/z/my-project/upload'

export async function POST(req: NextRequest) {
  let body: { name?: string; url?: string; path?: string; format?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const name = (body.name || '').trim()
  const url = (body.url || '').trim()
  const localPath = (body.path || '').trim()
  const format = (body.format || 'tar.gz').trim()

  if (!NAME_RE.test(name)) return NextResponse.json({ error: 'name must be alphanumeric (. _ - allowed)' }, { status: 400 })
  // v86: source is EITHER an http(s) URL OR a local file inside the upload
  // mount — the owner stores SDK archives in the platform's added storage
  // and could not use them at all before ("shorashori use korte parsena").
  // v91: the Google Drive sources were REMOVED at the owner's request —
  // everything now flows through Firebase Storage / direct upload only.
  let source = ''
  let sourceKind = ''
  let cleanupFile: string | null = null
  if (url) {
    if (!/^https?:\/\//.test(url)) return NextResponse.json({ error: 'url must start with http(s)://' }, { status: 400 })
    // v91: honest rejection of Drive links instead of silently downloading HTML.
    if (/drive\.google\.com|docs\.google\.com|drive\.usercontent\.google\.com/i.test(url))
      return NextResponse.json({ error: 'Google Drive links are no longer accepted (Drive support removed) — download the file on your device and use Upload from device, or host it on any direct URL' }, { status: 400 })
    source = url
    sourceKind = 'url'
  } else if (localPath) {
    const resolved = path.resolve(localPath)
    if (resolved !== UPLOAD_ROOT && !resolved.startsWith(UPLOAD_ROOT + path.sep))
      return NextResponse.json({ error: 'local path must be inside the platform upload storage (/home/z/my-project/upload)' }, { status: 400 })
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile())
      return NextResponse.json({ error: 'file not found in upload storage: ' + localPath }, { status: 404 })
    source = resolved
    sourceKind = 'upload'
  } else {
    return NextResponse.json({ error: 'provide url, path (upload storage file), or upload from device' }, { status: 400 })
  }
  if (!FORMATS.has(format)) return NextResponse.json({ error: `format must be one of ${[...FORMATS].join(', ')}` }, { status: 400 })
  if (MANAGED.some(m => m.name === name)) return NextResponse.json({ error: `'${name}' is a managed toolchain — it is installed/healed automatically` }, { status: 400 })

  const dest = path.join(CUSTOM_ROOT, name)
  // path traversal guard: resolve and re-check containment
  if (!path.resolve(dest).startsWith(path.resolve(CUSTOM_ROOT) + path.sep))
    return NextResponse.json({ error: 'invalid name' }, { status: 400 })

  const st = storage()
  if (st.freeGb > 0 && st.freeGb < 0.5)
    return NextResponse.json({ error: `only ${st.freeGb}GB free — free disk first (needs ≥512MB)` }, { status: 507 })

  try {
    fs.mkdirSync(dest, { recursive: true })
    fs.writeFileSync(path.join(dest, '.install-status'), 'installing')
  } catch (e: any) {
    if (cleanupFile) { try { fs.unlinkSync(cleanupFile) } catch {} }
    return NextResponse.json({ error: 'cannot create install dir: ' + e?.message }, { status: 500 })
  }

  // detached background install — API returns immediately, GET polls progress
  const child = spawn('bash', [path.join(BASE, 'scripts/custom-sdk-install.sh'), name, source, format], {
    cwd: BASE, detached: true, stdio: 'ignore',
    env: { ...process.env, PATH: process.env.PATH },
  })
  child.on('error', (e) => {
    try { fs.writeFileSync(path.join(dest, '.install-status'), 'failed: ' + e.message) } catch {}
    if (cleanupFile) { try { fs.unlinkSync(cleanupFile) } catch {} }
  })
  child.unref()

  return NextResponse.json({ ok: true, name, format, source: sourceKind, message: `installing '${name}' from ${sourceKind === 'upload' ? 'added storage' : 'URL'} in the background — poll GET /api/sdks for progress` }, { status: 202 })
}

// v86: uploads listing lives in the GET handler (?list=uploads) — PUT was
// the wrong verb for a read.

export async function DELETE(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name') || ''
  if (!NAME_RE.test(name)) return NextResponse.json({ error: 'invalid name' }, { status: 400 })
  const dest = path.join(CUSTOM_ROOT, name)
  if (!path.resolve(dest).startsWith(path.resolve(CUSTOM_ROOT) + path.sep))
    return NextResponse.json({ error: 'invalid name' }, { status: 400 })
  if (!fs.existsSync(dest)) return NextResponse.json({ error: 'not found' }, { status: 404 })
  try {
    fs.rmSync(dest, { recursive: true, force: true })
    return NextResponse.json({ ok: true, name })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}
