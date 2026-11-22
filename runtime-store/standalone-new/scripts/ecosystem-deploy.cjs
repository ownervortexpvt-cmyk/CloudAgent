#!/usr/bin/env node
/**
 * ECOSYSTEM DEPLOY RUNNER (v152) — push → live pipeline.
 *
 * Queued by the bare repo's post-receive hook on every `git push`, or by the
 * Code Hub's "Redeploy now". Steps mirror the panel chips exactly:
 *
 *   checkout → sync bare HEAD into the live tree (tracked files only)
 *   deps     → bun install ONLY where a manifest actually changed
 *   build    → VORTEX_SERVER production build ONLY when its code changed
 *   restart  → kill :3200, vx-supervisor respawns, wait for HTTP 200
 *
 * DATA SAFETY — this runner NEVER touches: db/, projects/, upload/, download/,
 * .env, node_modules (beyond installs), vortex-git/, .ecosystem/,
 * VORTEX_SERVER/{db,storage-pool}. Restores never reset runtime data.
 */
const { execFile, spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const BASE = '/home/z/my-project'
const BARE = path.join(BASE, 'vortex-git', 'vortex-ecosystem.git')
const STATE_DIR = path.join(BASE, '.ecosystem')
const STATE = path.join(STATE_DIR, 'deploy-state.json')
const HISTORY = path.join(STATE_DIR, 'deploy-history.json')
const LOCK = path.join(STATE_DIR, 'deploy.lock')
const VORTEX_DIR = path.join(BASE, 'vortex-platform', 'server', 'VORTEX_SERVER')

const NEVER_DELETE = [
  'db', 'projects', 'upload', 'download', 'vortex-git', '.ecosystem', 'node_modules',
  'vortex-platform/server/VORTEX_SERVER/db', 'vortex-platform/server/VORTEX_SERVER/storage-pool',
  'vortex-platform/server/VORTEX_SERVER/src/generated',
  'vortex-platform/cloudagent-runtime', 'runtime-store', 'sdk', 'tool-results', 'audit',
]
const NEVER_DELETE_FILE = [/^\.env(\.|$)/, /\.db$/, /\.sqlite/, /^\.secrets/, /\.log$/]

const argv = process.argv.slice(2)
function argOf(flag) {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const TRIGGER = argOf('--trigger') || 'manual'
let COMMIT = argOf('--commit') || ''
const OLD = argOf('--old') || ''
const ACTOR = argOf('--actor') || 'unknown'

const t0 = Date.now()
const steps = []
let lastError = null

function sh(cmd, opts = {}) {
  return new Promise((resolve) => {
    execFile('bash', ['-lc', cmd], { timeout: opts.timeout || 120000, cwd: opts.cwd || BASE, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (err.code || 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') })
    })
  })
}

function log(msg) {
  fs.appendFileSync(path.join(STATE_DIR, 'deploy.log'), `[${new Date().toISOString()}] ${msg}\n`)
}

function writeState(status, extra = {}) {
  const st = {
    status, trigger: TRIGGER, actor: ACTOR,
    commit: COMMIT || null, startedAt: t0,
    durationMs: Date.now() - t0, steps,
    lastError, ...(extra.note ? { note: extra.note } : {}),
  }
  try { fs.writeFileSync(STATE, JSON.stringify(st, null, 2)) } catch {}
}

function step(name, status, detail) {
  const i = steps.findIndex((s) => s.name === name)
  const row = { name, status, ...(detail ? { detail } : {}) }
  if (i >= 0) steps[i] = row
  else steps.push(row)
  writeState(['checkout', 'deps', 'build', 'restart'].includes(name) ? 'running' : status)
}

function pushHistory(status, error) {
  let rows = []
  try { rows = JSON.parse(fs.readFileSync(HISTORY, 'utf8')) } catch {}
  if (!Array.isArray(rows)) rows = []
  rows.unshift({ status, trigger: TRIGGER, actor: ACTOR, commit: COMMIT ? COMMIT.slice(0, 8) : undefined, durationMs: Date.now() - t0, error: error || undefined, at: Date.now() })
  fs.writeFileSync(HISTORY, JSON.stringify(rows.slice(0, 12), null, 2))
}

/* ─────────────────────────── lock ─────────────────────────── */
fs.mkdirSync(STATE_DIR, { recursive: true })
try {
  fs.mkdirSync(LOCK)
} catch (e) {
  const age = Date.now() - fs.statSync(LOCK).mtimeMs
  if (age > 20 * 60 * 1000) {
    log(`stale lock (${Math.round(age / 1000)}s) — stealing`)
    fs.rmdirSync(LOCK)
    try { fs.mkdirSync(LOCK) } catch (e2) { console.error('cannot take lock', e2); process.exit(1) }
  } else {
    log('deploy already running — exiting')
    process.exit(0)
  }
}
process.on('exit', () => { try { fs.rmdirSync(LOCK) } catch {} })

async function main() {
  log(`deploy start trigger=${TRIGGER} actor=${ACTOR} commit=${COMMIT || 'HEAD'}`)
  writeState('building')

  /* ── 1. checkout ── */
  step('checkout', 'running')
  if (!COMMIT) {
    const r = await sh(`git --git-dir=${BARE} rev-parse HEAD`)
    if (!r.ok || !r.stdout.trim()) {
      step('checkout', 'failed', 'bare repo has no commits')
      lastError = 'bare repo has no commits — seed it first'
      writeState('failed'); pushHistory('failed', lastError); return
    }
    COMMIT = r.stdout.trim()
  }
  let co = await sh(`git --git-dir=${BARE} --work-tree=${BASE} checkout -f main`)
  if (!co.ok) {
    step('checkout', 'failed', (co.stderr || co.stdout).slice(0, 400))
    lastError = 'checkout failed: ' + (co.stderr || co.stdout).slice(0, 300)
    writeState('failed'); pushHistory('failed', lastError); return
  }
  // propagate deletions from the pushed diff — with runtime-data guards
  if (OLD && OLD !== '0'.repeat(40) && OLD !== COMMIT) {
    const d = await sh(`git --git-dir=${BARE} diff --name-status ${OLD} ${COMMIT}`)
    for (const line of d.stdout.split('\n')) {
      const m = line.match(/^D\s+(.+)$/)
      if (!m) continue
      const rel = m[1].trim()
      const abs = path.resolve(BASE, rel)
      const norm = path.relative(BASE, abs).split(path.sep).join('/')
      if (!abs.startsWith(BASE + path.sep)) continue
      if (NEVER_DELETE.some((n) => norm === n || norm.startsWith(n + '/'))) continue
      if (NEVER_DELETE_FILE.some((re) => re.test(path.basename(norm)) || re.test(norm))) continue
      try { fs.rmSync(abs, { force: true }); log(`deleted ${norm}`) } catch {}
    }
  }
  step('checkout', 'done', `HEAD ${COMMIT.slice(0, 8)}`)

  /* ── 2. deps (only changed manifests) ── */
  step('deps', 'running')
  const manifestFiles = ['package.json', 'bun.lock', path.join('vortex-platform/server/VORTEX_SERVER', 'package.json')]
  const hashNow = {}
  for (const f of manifestFiles) {
    const p = path.join(BASE, f)
    hashNow[f] = fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16) : 'absent'
  }
  let lastDeps = {}
  try { lastDeps = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'last-deps.json'), 'utf8')) } catch {}
  const changed = manifestFiles.filter((f) => hashNow[f] !== lastDeps[f])
  if (changed.length === 0) {
    step('deps', 'done', 'manifests unchanged — skipped')
  } else {
    let depFail = null
    for (const dir of [BASE, VORTEX_DIR]) {
      const rel = path.relative(BASE, dir) || '.'
      const inst = await sh('bun install', { cwd: dir, timeout: 300000 })
      log(`bun install ${rel}: ok=${inst.ok}`)
      if (!inst.ok) depFail = `${rel}: ${(inst.stderr || inst.stdout).slice(-200)}`
    }
    if (!depFail) {
      await sh('bun run db:generate', { cwd: BASE, timeout: 120000 })
    }
    if (depFail) {
      step('deps', 'failed', depFail)
      lastError = 'deps failed: ' + depFail
      writeState('failed'); pushHistory('failed', lastError); return
    }
    fs.writeFileSync(path.join(STATE_DIR, 'last-deps.json'), JSON.stringify(hashNow, null, 2))
    step('deps', 'done', `reinstalled: ${changed.join(', ')}`)
  }

  /* ── 3. build VORTEX (only when its code changed / standalone missing) ── */
  step('build', 'running')
  let vortexChanged = true
  if (OLD && OLD !== '0'.repeat(40) && OLD !== COMMIT) {
    const d = await sh(`git --git-dir=${BARE} diff --name-only ${OLD} ${COMMIT} -- vortex-platform/`)
    vortexChanged = d.stdout.trim().length > 0
  }
  const standalone = path.join(VORTEX_DIR, '.next', 'standalone', 'server.js')
  if (!fs.existsSync(standalone)) vortexChanged = true
  if (!vortexChanged) {
    step('build', 'done', 'VORTEX unchanged — skipped')
  } else {
    log('building VORTEX_SERVER (webpack production)...')
    const b = await sh(
      'env -u TURBOPACK -u NODE_ENV ./node_modules/.bin/next build --webpack && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/',
      { cwd: VORTEX_DIR, timeout: 900000 },
    )
    if (!b.ok) {
      const tail = (b.stderr || b.stdout).trim().split('\n').slice(-8).join('\n')
      step('build', 'failed', tail.slice(0, 500))
      lastError = 'vortex build failed:\n' + tail.slice(0, 1200)
      writeState('failed'); pushHistory('failed', lastError); return
    }
    step('build', 'done', 'VORTEX production build OK')
  }

  /* ── 4. restart :3200 (vx-supervisor respawns it) ── */
  step('restart', 'running')
  await sh(`for p in $(ss -tlnp 2>/dev/null | grep ':3200 ' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do kill $p 2>/dev/null; done; true`)
  const alive = async () => {
    const r = await sh('curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3200/')
    return r.stdout.trim() === '200'
  }
  let up = false
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    if (await alive()) { up = true; break }
  }
  if (!up) {
    // fallback: supervisor may be dead — start standalone ourselves, detached
    log('supervisor did not respawn :3200 — starting standalone directly')
    const tick = fs.existsSync(path.join(VORTEX_DIR, '.tick-secret')) ? fs.readFileSync(path.join(VORTEX_DIR, '.tick-secret'), 'utf8').trim() : 'vxtick_fallback_2026'
    const child = spawn('node', [standalone], {
      cwd: path.dirname(standalone), detached: true, stdio: 'ignore',
      env: { ...process.env, PORT: '3200', HOSTNAME: '127.0.0.1', NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=512', DATABASE_URL: `file:${VORTEX_DIR}/db/custom.db`, VORTEX_STORAGE_ROOT: `${VORTEX_DIR}/storage-pool`, VX_TICK_SECRET: tick },
    })
    child.unref()
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      if (await alive()) { up = true; break }
    }
  }
  if (!up) {
    step('restart', 'failed', ':3200 did not come back in 90s')
    lastError = 'restart failed — :3200 not healthy; previous build may still be serving'
    writeState('failed'); pushHistory('failed', lastError); return
  }
  step('restart', 'done', ':3200 healthy')

  writeState('live')
  pushHistory('live')
  log(`deploy DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

main().catch((e) => {
  lastError = String(e?.stack || e).slice(0, 1200)
  writeState('failed')
  pushHistory('failed', lastError)
  log('deploy crashed: ' + lastError)
})
