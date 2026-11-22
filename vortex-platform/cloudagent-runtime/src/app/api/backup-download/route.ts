import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { requireAdmin } from '@/lib/auth'

/**
 * v105 — FULL PROJECT ZIP DOWNLOAD (owner-requested: "Ei puro project er zip chai").
 *
 * Serves the newest `cloud-agent-full-backup-*.zip` from download/ as a real
 * file download. Two auth channels, both explicit:
 *   1. `?token=<hex>` — a 24h token stored in UserSetting("zip_download_token"),
 *      minted for the owner so a plain browser LINK works (links can't send
 *      the x-ca-lock header). Fail-closed: wrong/expired token = 403/410.
 *   2. Normal ADMIN session — used by the control room's Data tab.
 *
 * v116 — IP-LEAK KILL: this ZIP is the ENTIRE platform (source, database,
 * scripts, user apps). Under the old lock-guard ANY signed-in user could
 * mint a token and walk away with the whole business. Now ONLY the owner
 * (role=admin) may mint tokens or download; token links keep working for
 * the owner's plain-browser download flow.
 */

const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || '/home/z/my-project/download'
const ZIP_NAME_RE = /^cloud-agent-full-backup-\d{8}\.zip$/
const TOKEN_KEY = 'zip_download_token'

function newestBackupZip(): { file: string; name: string } | null {
  try {
    const candidates = fs.readdirSync(DOWNLOAD_DIR)
      .filter(f => ZIP_NAME_RE.test(f))
      .map(f => ({ f, m: fs.statSync(path.join(DOWNLOAD_DIR, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
    if (!candidates.length) return null
    return { file: path.join(DOWNLOAD_DIR, candidates[0].f), name: candidates[0].f }
  } catch {
    return null
  }
}

// v105b: sandbox container recycles WIPE every gitignored file — download/*.zip
// is deliberately not in git, and the 20260924 zip vanished live when the
// container was rebuilt (new rootfs id, uptime reset). So the route now BUILDS
// the backup zip on demand when none exists: the download link self-heals
// after any recycle. First request waits ~30-60s while zip runs; the single
// buildPromise guard keeps concurrent requests from double-building.
const PROJECT_ROOT = process.env.PROJECT_ROOT || '/home/z/my-project'
const ZIP_EXCLUDES = [
  'node_modules/*', '.next/*', 'sdk/*', '.git/*', 'download/*',
  'dev.log', 'dev-watchdog.log', 'socket-service.log', '.build-prod.log',
  '.next-prod-backup*', '*.import-*.zip', '.sw*/*', '.e2e-*.zip',
]
let buildPromise: Promise<string | null> | null = null

function buildBackupZip(): Promise<string | null> {
  if (buildPromise) return buildPromise
  buildPromise = (async () => {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const name = `cloud-agent-full-backup-${day}.zip`
    const finalPath = path.join(DOWNLOAD_DIR, name)
    const tmpPath = path.join(DOWNLOAD_DIR, `.building-${name}`)
    try {
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })
      // disk guard — the zip needs ~55MB plus working room
      const st = fs.statfsSync(PROJECT_ROOT)
      if (st.bsize * st.bavail < 200 * 1024 * 1024) throw new Error('disk nearly full')
      await new Promise<void>((resolve, reject) => {
        const { spawn } = require('child_process') as typeof import('child_process')
        const p = spawn('zip', ['-ry', tmpPath, '.', '-x', ...ZIP_EXCLUDES], { cwd: PROJECT_ROOT, stdio: 'ignore' })
        const timer = setTimeout(() => p.kill('SIGKILL'), 180_000)
        p.on('exit', c => { clearTimeout(timer); c === 0 ? resolve() : reject(new Error(`zip exited ${c}`)) })
        p.on('error', e => { clearTimeout(timer); reject(e) })
      })
      fs.renameSync(tmpPath, finalPath)
      return finalPath
    } catch (e) {
      try { fs.unlinkSync(tmpPath) } catch { /* already gone */ }
      console.error('[backup-download] on-demand zip build failed:', (e as Error).message)
      return null
    } finally {
      buildPromise = null
    }
  })()
  return buildPromise
}

async function tokenValid(token: string): Promise<boolean> {
  if (!token || !/^[a-f0-9]{48}$/.test(token)) return false
  const { db } = await import('@/lib/db')
  const raw = (await db.userSetting.findUnique({ where: { key: TOKEN_KEY } }).catch(() => null))?.value
  if (!raw) return false
  try {
    const parsed = JSON.parse(raw) as { token?: string; exp?: number }
    if (parsed.token !== token) return false
    if (!parsed.exp || Date.now() > parsed.exp) return false
    return true
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  // v105: ?mint=1 — an unlocked caller (lock cookie OR x-ca-lock header, which
  // LockTokenBridge injects even inside embedded previews) gets a FRESH 24h
  // download token back as JSON. The client then triggers a NATIVE anchor
  // download with ?token=... — no fetch, no blob-in-RAM (53MB was dying on
  // phones), no instant-revoke cancel. This is now the primary UI path.
  if (req.nextUrl.searchParams.get('mint') === '1') {
    try {
      await requireAdmin(req)
    } catch (e: any) {
      if (e instanceof Response) return e as any
      throw e
    }
    const crypto = await import('crypto')
    const token = crypto.randomBytes(24).toString('hex')
    const exp = Date.now() + 24 * 60 * 60 * 1000
    const { db } = await import('@/lib/db')
    await db.userSetting.upsert({
      where: { key: TOKEN_KEY },
      update: { value: JSON.stringify({ token, exp }) },
      create: { key: TOKEN_KEY, value: JSON.stringify({ token, exp }) },
    }).catch(() => {})
    return NextResponse.json({ ok: true, token, expiresInHours: 24 })
  }

  // v116: token path stays (owner's native-download flow, fail-closed below);
  // the fallback session path is now ADMIN-only instead of any unlocked user.
  const token = req.nextUrl.searchParams.get('token') || ''
  const viaToken = await tokenValid(token)
  if (!viaToken) {
    try {
      await requireAdmin(req)
    } catch (e: any) {
      if (e instanceof Response) return e as any
      throw e
    }
  }

  // v105b: no zip on disk (e.g. right after a container recycle) → build one
  // on the spot instead of failing with 404. First call waits ~30-60s.
  let zip = newestBackupZip()
  if (!zip) {
    const built = await buildBackupZip()
    if (!built) {
      return NextResponse.json({ ok: false, error: 'backup zip build failed — see server logs, or ask the agent' }, { status: 503 })
    }
    zip = { file: built, name: path.basename(built) }
  }

  const stat = fs.statSync(zip.file)
  const stream = Readable.toWeb(fs.createReadStream(zip.file)) as unknown as ReadableStream
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(stat.size),
      'Content-Disposition': `attachment; filename="${zip.name}"`,
      'Cache-Control': 'no-store',
      'X-Backup-Auth': viaToken ? 'token' : 'lock',
    },
  })
}
