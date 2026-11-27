import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { requireAdminUnlocked } from '@/lib/admin-lock'
import {
  ECOSYSTEM_BARE,
  ECOSYSTEM_DEPLOY_HISTORY,
  ECOSYSTEM_DEPLOY_STATE,
  ECOSYSTEM_LIVE,
  ECOSYSTEM_REPO_NAME,
  ECOSYSTEM_STATE_DIR,
  cloneUrlFor,
  createEcoToken,
  ecosystemRepoInfo,
  listEcoTokens,
  publicOrigin,
  revokeEcoToken,
  safeBrowserPath,
} from '@/lib/ecosystem-git'

/**
 * ECOSYSTEM CODE HUB — control-room API (v152).
 * Double-gated by requireAdminUnlocked (admin session + room PIN token).
 *
 * GET  ?view=overview|tokens|tree|file|deploys
 * POST { action: 'create-token' | 'revoke-token' | 'redeploy', ... }
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_FILE_VIEW = 400 * 1024 // 400 KB per file view
const TEXT_EXT_BLOCKLIST = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|otf|mp4|mp3|wav|apk|jar|so|dylib|dll|wasm|node)$/i

async function readJson(p: string): Promise<any> {
  try { return JSON.parse(await fs.readFile(p, 'utf8')) } catch { return null }
}

async function gitBare(args: string[], timeout = 15000): Promise<string> {
  const { execFile } = await import('child_process')
  return new Promise((resolve) => {
    execFile('git', ['--git-dir', ECOSYSTEM_BARE, ...args], { timeout }, (err, stdout) => {
      resolve(err ? '' : String(stdout || ''))
    })
  })
}

async function vortexHealth(): Promise<string> {
  const { execFile } = await import('child_process')
  return new Promise((resolve) => {
    execFile('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '5', 'http://127.0.0.1:3200/'], { timeout: 8000 }, (err, stdout) => {
      resolve(String(stdout || '000').trim())
    })
  })
}

/** A mid-flight status is only REAL while the deploy.lock exists and is
 * fresh — a runner killed by a sandbox reaper leaves a stale state file,
 * and the panel must tell the truth instead of spinning forever. */
async function effectiveDeployStatus(): Promise<string> {
  try {
    const st = await readJson(ECOSYSTEM_DEPLOY_STATE)
    const status = st?.status || 'idle'
    if (!['building', 'restarting', 'queued', 'running'].includes(status)) return status
    const lock = path.join(ECOSYSTEM_STATE_DIR, 'deploy.lock')
    const stat = await fs.stat(lock).catch(() => null)
    if (!stat || Date.now() - stat.mtimeMs > 20 * 60 * 1000) return 'interrupted'
    return status
  } catch {
    return 'idle'
  }
}

function spawnDetachedDeploy(): boolean {
  try {
    // v162: project-RELATIVE path (cwd is /home/z/my-project) — Next 16's
    // server tracer rejects absolute spawn paths outside the project root.
    const child = spawn('node', ['scripts/ecosystem-deploy.cjs', '--trigger', 'manual', '--actor', 'admin-panel'], {
      cwd: '/home/z/my-project',
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    return true
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireAdminUnlocked(req)
  } catch (e: any) {
    if (e instanceof Response || e?.status) return e as any
    throw e
  }

  const view = req.nextUrl.searchParams.get('view') || 'overview'
  const url = new URL(req.url)
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host
  const proto = req.headers.get('x-forwarded-proto') || (host?.startsWith('localhost') ? 'http' : 'https')
  const origin = publicOrigin(host, proto)
  const cloneUrl = cloneUrlFor(origin)

  if (view === 'overview') {
    const [repo, deployRaw, history, vx, eff] = await Promise.all([
      ecosystemRepoInfo(),
      readJson(ECOSYSTEM_DEPLOY_STATE),
      readJson(ECOSYSTEM_DEPLOY_HISTORY),
      vortexHealth(),
      effectiveDeployStatus(),
    ])
    const deploy = deployRaw || { status: 'idle' }
    if (eff === 'interrupted' && deploy.status !== 'interrupted') {
      deploy.status = 'interrupted'
      deploy.lastError = (deploy.lastError ? deploy.lastError + '\n' : '') +
        'deploy runner died mid-flight (sandbox reaper) — hit Redeploy now; the previous build kept serving.'
    }
    return NextResponse.json({
      ok: true,
      cloneUrl,
      repoName: ECOSYSTEM_REPO_NAME,
      repo,
      deploy,
      history: Array.isArray(history) ? history.slice(0, 12) : [],
      vortexHealth: vx,
      cloudagentMode: 'dev', // file edits go live via HMR — no rebuild needed
      host,
    })
  }

  if (view === 'tokens') {
    return NextResponse.json({ ok: true, tokens: await listEcoTokens() })
  }

  // v164 — commit history: the honest push log (who pushed what, when).
  if (view === 'commits') {
    const raw = await gitBare(['log', '--pretty=format:%H%x1f%an%x1f%aI%x1f%s', '-20'])
    const commits = raw.split('\n').filter(Boolean).map(line => {
      const [hash, author, date, subject] = line.split('\x1f')
      return { hash, author, date, subject }
    })
    const head = (await gitBare(['rev-parse', '--short', 'HEAD'])).trim()
    return NextResponse.json({ ok: true, head, commits })
  }

  if (view === 'tree') {
    const rel = req.nextUrl.searchParams.get('path') || ''
    const abs = rel ? safeBrowserPath(rel) : ECOSYSTEM_LIVE
    if (!abs) return NextResponse.json({ ok: false, error: 'path not browsable' }, { status: 403 })
    let entries: Array<{ name: string; type: 'dir' | 'file'; size: number }>
    try {
      const dirents = await fs.readdir(abs, { withFileTypes: true })
      const list = await Promise.all(
        dirents
          .filter((d) => {
            if (!rel && ['node_modules', '.git', '.next', '.ecosystem', 'vortex-git', 'projects', 'upload', 'download', 'db-rescue', 'sdk', 'tool-results', 'audit', 'bin', 'logs', 'out', 'build', '.secrets', '.dev-watchdog.lock'].includes(d.name)) return false
            const child = safeBrowserPath(path.posix.join(rel, d.name))
            return !!child
          })
          .map(async (d) => {
            const child = path.join(abs, d.name)
            let size = 0
            try { size = d.isDirectory() ? 0 : (await fs.stat(child)).size } catch {}
            return { name: d.name, type: d.isDirectory() ? ('dir' as const) : ('file' as const), size }
          }),
      )
      entries = list.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
    } catch {
      return NextResponse.json({ ok: false, error: 'cannot read directory' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, path: rel, entries })
  }

  if (view === 'file') {
    const rel = req.nextUrl.searchParams.get('path') || ''
    const abs = safeBrowserPath(rel)
    if (!abs || !rel) return NextResponse.json({ ok: false, error: 'path not browsable' }, { status: 403 })
    let stat
    try { stat = await fs.stat(abs) } catch {
      return NextResponse.json({ ok: false, error: 'file not found' }, { status: 404 })
    }
    if (stat.isDirectory()) return NextResponse.json({ ok: false, error: 'path is a directory' }, { status: 400 })
    if (stat.size > MAX_FILE_VIEW) {
      return NextResponse.json({ ok: true, truncated: true, size: stat.size, content: `// file too large to preview in the Code Hub (${(stat.size / 1024).toFixed(0)} KB) — open it from your editor via git clone` })
    }
    const buf = await fs.readFile(abs)
    const binary = TEXT_EXT_BLOCKLIST.test(rel) || buf.subarray(0, 8000).includes(0)
    if (binary) {
      return NextResponse.json({ ok: true, binary: true, size: stat.size, content: `// binary file (${(stat.size / 1024).toFixed(1)} KB)` })
    }
    return NextResponse.json({ ok: true, size: stat.size, content: buf.toString('utf8') })
  }

  return NextResponse.json({ ok: false, error: 'unknown view' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  try {
    await requireAdminUnlocked(req)
  } catch (e: any) {
    if (e instanceof Response || e?.status) return e as any
    throw e
  }
  const body = await req.json().catch(() => ({}))
  const action = body?.action

  if (action === 'create-token') {
    const name = String(body?.name || '').trim() || 'editor'
    const { token, row } = await createEcoToken(name)
    return NextResponse.json({ ok: true, token, row })
  }

  if (action === 'revoke-token') {
    const ok = await revokeEcoToken(String(body?.id || ''))
    return NextResponse.json({ ok, error: ok ? undefined : 'token not found' }, { status: ok ? 200 : 404 })
  }

  if (action === 'redeploy') {
    // re-checkout HEAD + full pipeline; refuses while a REAL deploy is mid-flight
    const eff = await effectiveDeployStatus()
    if (['building', 'queued', 'restarting', 'running'].includes(eff)) {
      return NextResponse.json({ ok: false, error: 'a deploy is already running' }, { status: 409 })
    }
    if (eff === 'interrupted') {
      // clear the stale state so the runner starts clean, and remove any dead lock
      try { await fs.rm(path.join(ECOSYSTEM_STATE_DIR, 'deploy.lock'), { recursive: true, force: true }) } catch {}
      try {
        const st = await readJson(ECOSYSTEM_DEPLOY_STATE)
        if (st) { st.status = 'idle'; await fs.writeFile(ECOSYSTEM_DEPLOY_STATE, JSON.stringify(st, null, 2)) }
      } catch {}
    }
    const queued = spawnDetachedDeploy()
    return NextResponse.json({ ok: queued, error: queued ? undefined : 'could not spawn deploy runner' })
  }

  // v164 — export-source: full source archive of HEAD as a zip in download/.
  // Uses git archive on the bare repo — never touches the live tree.
  if (action === 'export-source') {
    const { execFile } = await import('child_process')
    const head = (await gitBare(['rev-parse', '--short', 'HEAD'])).trim() || 'head'
    const outName = `vortex-ecosystem-source-${head}-${Date.now()}.zip`
    const outPath = path.join('/home/z/my-project/download', outName)
    const okZip = await new Promise<boolean>((resolve) => {
      execFile('git', ['--git-dir', ECOSYSTEM_BARE, 'archive', '--format=zip', '-o', outPath, 'HEAD'], { timeout: 60_000 }, (err) => resolve(!err))
    })
    if (!okZip) return NextResponse.json({ ok: false, error: 'git archive failed' }, { status: 500 })
    let size = 0
    try { size = (await fs.stat(outPath)).size } catch {}
    return NextResponse.json({ ok: true, file: outName, size, head })
  }

  return NextResponse.json({ ok: false, error: 'unknown action — use create-token | revoke-token | redeploy | export-source' }, { status: 400 })
}

// v152.1 hidden-file filter sync
