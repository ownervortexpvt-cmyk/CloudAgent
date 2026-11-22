/**
 * v81 — "Add Storage" automatic SDK provisioning engine.
 *
 * THE PROMISE: the moment a project is created (language picked) or a ZIP is
 * imported (language sniffed from its files), every managed toolchain that
 * stack needs is installed automatically into the persistent sdk/ storage —
 * no manual SDK Manager visit, no restart. Projects are never blocked while
 * this happens: installation runs in the background (detached children of
 * the long-lived next-server process — the v79b discovery: those survive).
 *
 * Persistence model: everything lands under /home/z/my-project/sdk/ (the
 * same storage sdk-doctor auto-heals after a snapshot wipe). Job state lives
 * in sdk/.provision/<projectId>.json so the status survives server restarts
 * and can be re-read any time by GET /api/sdks/provision.
 *
 * Honest limits (never fake success):
 *  - Disk guard: if the free space is below the estimated need (+ floor),
 *    items are marked 'blocked-disk' with the real numbers, not started.
 *  - NDK-sized stacks on a 96%-full volume will honestly report blocked.
 *  - Toolchains already present are reported 'already-ready' (no re-download).
 */

import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { MANAGED_TOOLCHAINS, toolchainByName } from '@/lib/toolchains'

const BASE = '/home/z/my-project'
const PROVISION_DIR = path.join(BASE, 'sdk', '.provision')
const SDK_DOCTOR_LOCK = path.join(BASE, '.sdk-doctor.lock')

/**
 * Language → managed toolchains needed.
 * Keys cover BOTH naming worlds: languages.ts ids (what the builder sends)
 * and framework.ts detection codes (what zip-import detection returns).
 * Node/python/html stacks need nothing managed — the sandbox ships node/bun.
 */
export const LANG_TOOLCHAINS: Record<string, string[]> = {
  dart: ['flutter', 'android', 'jdk'],
  flutter: ['flutter', 'android', 'jdk'],
  capacitor: ['android', 'jdk', 'gradle'],
  java: ['jdk', 'gradle', 'maven'],
  kotlin: ['jdk', 'kotlin', 'gradle'],
  csharp: ['dotnet'],
  cs: ['dotnet'],
  go: ['go'],
  rust: ['rust'],
  rs: ['rust'],
  php: ['php'],
  cpp: ['cmake', 'ninja'],
  c: ['cmake', 'ninja'],
}

/* ------------------------------------------------------------------ */
/* Language sniffing for ZIP imports                                   */
/* ------------------------------------------------------------------ */

/** Walk a project dir and guess the language from marker files. Returns a
 *  LANG_TOOLCHAINS key (or null — node/html/python need nothing managed). */
export function sniffLanguage(root: string): string | null {
  const has = (...rel: string[]) => rel.some(r => fs.existsSync(path.join(root, r)))
  const findExt = (ext: string, depth = 3, dir = root): string | null => {
    if (depth < 0) return null
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { const hit = findExt(ext, depth - 1, p); if (hit) return hit }
        else if (e.name.endsWith(ext)) return p
      }
    } catch { /* unreadable subtree */ }
    return null
  }
  try {
    if (has('pubspec.yaml')) return 'dart'
    if (findExt('.csproj') || has('global.json')) return 'csharp'
    if (has('go.mod', 'go.sum')) return 'go'
    if (has('Cargo.toml')) return 'rust'
    if (has('composer.json')) return 'php'
    if (has('CMakeLists.txt', 'Makefile')) return 'cpp'
    if (has('pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle')) return 'java'
    if (findExt('.kt') || findExt('.kts')) return 'kotlin'
    // package.json — only Capacitor implies a managed toolchain (Android)
    const pkgPath = path.join(root, 'package.json')
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
        if (Object.keys(deps).some(d => d.startsWith('@capacitor/'))) return 'capacitor'
      } catch { /* malformed package.json */ }
    }
    return null
  } catch { return null }
}

/* ------------------------------------------------------------------ */
/* Disk guard                                                          */
/* ------------------------------------------------------------------ */

function freeMb(): number {
  try {
    const st = fs.statfsSync('/')
    return Math.floor((st.bavail * st.bsize) / 1048576)
  } catch { return -1 }
}

/* ------------------------------------------------------------------ */
/* Job state                                                           */
/* ------------------------------------------------------------------ */

export interface ProvisionItem {
  name: string
  needed: boolean
  present: boolean
  action: 'already-ready' | 'installing' | 'installed' | 'failed' | 'blocked-disk' | 'probe-error'
  detail?: string
}
export interface ProvisionJob {
  projectId: string
  projectName: string
  language: string
  source: 'create' | 'import' | 'manual' | 'heal-all'
  startedAt: string
  updatedAt: string
  items: ProvisionItem[]
}

function jobFile(projectId: string): string {
  return path.join(PROVISION_DIR, `${projectId.replace(/[^a-zA-Z0-9_-]/g, '')}.json`)
}

function readJob(projectId: string): ProvisionJob | null {
  try {
    return JSON.parse(fs.readFileSync(jobFile(projectId), 'utf8')) as ProvisionJob
  } catch { return null }
}

function writeJob(job: ProvisionJob) {
  fs.mkdirSync(PROVISION_DIR, { recursive: true })
  job.updatedAt = new Date().toISOString()
  fs.writeFileSync(jobFile(job.projectId), JSON.stringify(job, null, 2))
}

function isAlive(pid?: number): boolean {
  if (!pid || pid <= 0) return false
  try { return fs.existsSync(`/proc/${pid}`) } catch { return false }
}

/* ------------------------------------------------------------------ */
/* Trigger                                                             */
/* ------------------------------------------------------------------ */

const RESERVED = new Set(MANAGED_TOOLCHAINS.map(t => t.name))

/**
 * Ensure the toolchains a language needs are installed. Idempotent:
 * present items are recorded as 'already-ready', only missing ones spawn
 * a setup script. Never throws — provisioning must never fail a project
 * create/import; failures land in the job record instead.
 */
export function triggerProvisioning(opts: {
  projectId: string
  projectName?: string
  language: string | null | undefined
  source: ProvisionJob['source']
}): { started: boolean; language: string; items: ProvisionItem[]; skippedReason?: string } {
  const lang = String(opts.language || '').toLowerCase()
  const wanted = LANG_TOOLCHAINS[lang] || []

  // Everything requested is already installed? Record a satisfied job so the
  // UI can show "ready" instead of silently doing nothing.
  const items: ProvisionItem[] = wanted.map(name => {
    const tc = toolchainByName(name)
    const present = !!tc && fs.existsSync(path.join(BASE, tc.probe))
    return { name, needed: true, present, action: present ? 'already-ready' : 'installing' }
  })

  if (!wanted.length) {
    return { started: false, language: lang || 'auto', items: [], skippedReason: 'no managed toolchains needed for this stack' }
  }

  // Merge with an existing job for the same project (keep terminal history,
  // refresh in-flight entries) and never double-spawn a live install.
  const prev = readJob(opts.projectId)
  const merged: ProvisionJob = {
    projectId: opts.projectId,
    projectName: opts.projectName || prev?.projectName || opts.projectId,
    language: lang,
    source: opts.source,
    startedAt: prev?.startedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items,
  }

  const missing = items.filter(i => !i.present)
  if (!missing.length) {
    writeJob(merged)
    return { started: false, language: lang, items }
  }

  // disk guard: estimate the install size of everything missing + 150MB floor
  const needMb = missing.reduce((s, i) => s + (toolchainByName(i.name)?.approxMb || 200), 0)
  const free = freeMb()
  if (free >= 0 && free < needMb + 150) {
    for (const i of missing) {
      i.action = 'blocked-disk'
      i.detail = `needs ~${toolchainByName(i.name)?.approxMb || '?'}MB but only ${free}MB free on the 9.9GB platform volume — free disk (old artifacts, custom SDKs) and press Retry, or let published artifacts overflow to your Firebase Storage vault`
    }
    writeJob(merged)
    return { started: false, language: lang, items, skippedReason: 'disk guard — see items' }
  }

  for (const i of missing) {
    const tc = toolchainByName(i.name)!
    const logPath = path.join(PROVISION_DIR, `log-${i.name}-${merged.projectId.slice(-6)}.log`)
    const donePath = path.join(PROVISION_DIR, `done-${i.name}-${merged.projectId.slice(-6)}`)
    const pidPath = path.join(PROVISION_DIR, `pid-${i.name}-${merged.projectId.slice(-6)}`)

    // already installing for this project? (live pid recorded from a previous run)
    try {
      const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10)
      if (isAlive(pid)) { i.action = 'installing'; i.detail = 'already running from an earlier trigger' ; continue }
    } catch { /* no pid yet */ }
    try { fs.rmSync(donePath, { force: true }) } catch { /* first run */ }

    fs.mkdirSync(PROVISION_DIR, { recursive: true })
    // wrapper: run the idempotent v79 setup script, then drop a done marker
    // with the exit code — the detached child self-reports completion.
    const wrapper = `bash ${path.join(BASE, 'scripts', tc.setup)} >> ${logPath} 2>&1; code=$?; echo $code > ${donePath}; exit $code`
    try {
      const child = spawn('bash', ['-c', wrapper], {
        cwd: BASE, detached: true, stdio: 'ignore',
        env: { ...process.env, PATH: process.env.PATH },
      })
      child.on('error', (e) => {
        try { i.action = 'failed'; i.detail = e.message; writeJob(merged) } catch { /* job gone */ }
      })
      child.unref()
      fs.writeFileSync(pidPath, String(child.pid || 0))
      i.action = 'installing'
      i.detail = `setup-${i.name}.sh running in the background (pid ${child.pid}) — log: sdk/.provision/log-${i.name}-${merged.projectId.slice(-6)}.log`
    } catch (e: any) {
      i.action = 'failed'
      i.detail = e?.message || 'spawn failed'
    }
  }

  writeJob(merged)
  return { started: missing.some(i => i.action === 'installing'), language: lang, items }
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

/** Re-probe a job's items: 'installing' items whose setup script dropped a
 *  done-marker graduate to installed/failed; presence is re-checked live. */
function refreshJob(job: ProvisionJob): ProvisionJob {
  let changed = false
  for (const i of job.items) {
    const tc = toolchainByName(i.name)
    const present = !!tc && fs.existsSync(path.join(BASE, tc.probe))
    if (i.present !== present) { i.present = present; changed = true }
    if (i.action === 'installing' && present) {
      i.action = 'installed'
      i.detail = 'setup finished — probe visible'
      changed = true
      continue
    }
    if (i.action === 'installing' && !present) {
      const donePath = path.join(PROVISION_DIR, `done-${i.name}-${job.projectId.slice(-6)}`)
      try {
        const code = fs.readFileSync(donePath, 'utf8').trim()
        if (code !== '') {
          i.action = code === '0' ? 'installed' : 'failed'
          i.detail = code === '0'
            ? 'setup exited 0 but probe still missing (may need the next boot heal — press Retry)'
            : `setup script exited ${code} — see the log in sdk/.provision/`
          changed = true
        }
      } catch { /* still running */ }
    }
  }
  if (changed) writeJob(job)
  return job
}

/** All provisioning jobs, newest first. Optionally filtered to one project. */
export function getProvisionStatus(projectId?: string): ProvisionJob[] {
  const jobs: ProvisionJob[] = []
  try {
    if (projectId) {
      const j = readJob(projectId)
      if (j) jobs.push(refreshJob(j))
    } else {
      for (const f of fs.readdirSync(PROVISION_DIR)) {
        if (!f.endsWith('.json')) continue
        try { jobs.push(refreshJob(JSON.parse(fs.readFileSync(path.join(PROVISION_DIR, f), 'utf8')))) } catch { /* corrupt job file */ }
      }
      jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    }
  } catch { /* no provisioning yet */ }
  return jobs.slice(0, 50)
}

/** Recent tail of a provisioning setup log (for the UI). */
export function provisionLogTail(name: string, projectId: string, lines = 12): string {
  try {
    const p = path.join(PROVISION_DIR, `log-${name}-${projectId.slice(-6)}.log`)
    return fs.readFileSync(p, 'utf8').split('\n').slice(-lines).join('\n')
  } catch { return '' }
}

/** Heal-all: provision every missing managed toolchain (boot-doctor backup). */
export function healAllMissing(): { started: boolean; items: ProvisionItem[] } {
  // skip while sdk-doctor is mid-heal (lock touched within 30 min)
  try {
    if (fs.existsSync(SDK_DOCTOR_LOCK) && Date.now() - fs.statSync(SDK_DOCTOR_LOCK).mtimeMs < 30 * 60 * 1000) {
      return { started: false, items: MANAGED_TOOLCHAINS.map(t => ({ name: t.name, needed: true, present: fs.existsSync(path.join(BASE, t.probe)), action: 'already-ready', detail: 'sdk-doctor is currently healing toolchains — check back shortly' })) }
    }
  } catch { /* lock unreadable — proceed */ }

  const items: ProvisionItem[] = MANAGED_TOOLCHAINS.map(t => ({
    name: t.name, needed: true,
    present: fs.existsSync(path.join(BASE, t.probe)),
    action: 'already-ready',
  }))
  const missing = items.filter(i => !i.present)

  // NDK is almost always disk-blocked on this 9.9G box — keep the honest note.
  const needMb = missing.reduce((s, i) => s + (toolchainByName(i.name)?.approxMb || 200), 0)
  const free = freeMb()
  if (free >= 0 && free < needMb + 150) {
    for (const i of missing) {
      i.action = 'blocked-disk'
      i.detail = `needs ~${toolchainByName(i.name)?.approxMb || '?'}MB, ${free}MB free — free disk or expand storage, then retry`
    }
    return { started: false, items }
  }
  for (const i of missing) {
    const tc = toolchainByName(i.name)!
    const logPath = path.join(PROVISION_DIR, `log-${i.name}-heal.log`)
    const donePath = path.join(PROVISION_DIR, `done-${i.name}-heal`)
    const pidPath = path.join(PROVISION_DIR, `pid-${i.name}-heal`)
    try {
      const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10)
      if (isAlive(pid)) { i.action = 'installing'; continue }
    } catch { /* not running yet */ }
    try { fs.rmSync(donePath, { force: true }) } catch { /* first run */ }
    try {
      const child = spawn('bash', ['-c', `bash ${path.join(BASE, 'scripts', tc.setup)} >> ${logPath} 2>&1; code=$?; echo $code > ${donePath}; exit $code`], {
        cwd: BASE, detached: true, stdio: 'ignore', env: { ...process.env, PATH: process.env.PATH },
      })
      child.on('error', () => { i.action = 'failed' })
      child.unref()
      fs.writeFileSync(pidPath, String(child.pid || 0))
      i.action = 'installing'
    } catch { i.action = 'failed' }
  }
  return { started: missing.some(i => i.action === 'installing'), items }
}

/**
 * v94 — one-click install of a SINGLE managed toolchain (SDK Manager grid
 * button). Same mechanics as healAllMissing but scoped to one name, with its
 * own synthetic job (`_manual`) so GET /api/sdks/provision shows live
 * progress and the done-marker graduation works unchanged.
 */
export function installOneToolchain(name: string): { started: boolean; item: ProvisionItem } {
  const tc = toolchainByName(name)
  if (!tc) {
    return { started: false, item: { name, needed: true, present: false, action: 'failed', detail: 'unknown managed toolchain' } }
  }
  const present = fs.existsSync(path.join(BASE, tc.probe))
  const item: ProvisionItem = { name, needed: true, present, action: present ? 'already-ready' : 'installing' }
  if (present) {
    item.detail = 'already installed — nothing to do'
    return { started: false, item }
  }
  // skip while sdk-doctor is mid-heal (same guard as heal-all)
  try {
    if (fs.existsSync(SDK_DOCTOR_LOCK) && Date.now() - fs.statSync(SDK_DOCTOR_LOCK).mtimeMs < 30 * 60 * 1000) {
      item.action = 'installing'
      item.detail = 'sdk-doctor is currently healing toolchains — this install is already covered'
      return { started: false, item }
    }
  } catch { /* lock unreadable — proceed */ }

  // disk guard — honest numbers, never fake-start
  const free = freeMb()
  if (free >= 0 && free < tc.approxMb + 150) {
    item.action = 'blocked-disk'
    item.detail = `needs ~${tc.approxMb}MB but only ${free}MB free on the 9.9GB volume — free disk (old artifacts, custom SDKs) and retry`
    return { started: false, item }
  }

  const JOB_ID = '_manual'
  const logPath = path.join(PROVISION_DIR, `log-${name}-heal.log`)
  const donePath = path.join(PROVISION_DIR, `done-${name}-heal`)
  const pidPath = path.join(PROVISION_DIR, `pid-${name}-heal`)
  try {
    const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10)
    if (isAlive(pid)) {
      item.detail = 'already running from an earlier press'
      return { started: false, item }
    }
  } catch { /* not running yet */ }
  try { fs.rmSync(donePath, { force: true }) } catch { /* first run */ }

  // record a visible job for the provision status panel
  try {
    fs.mkdirSync(PROVISION_DIR, { recursive: true })
    const jobFile = path.join(PROVISION_DIR, `${JOB_ID}.json`)
    let job: ProvisionJob = { projectId: JOB_ID, projectName: 'SDK Manager install', language: name, source: 'manual', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), items: [item] }
    try { job = JSON.parse(fs.readFileSync(jobFile, 'utf8')) as ProvisionJob } catch { /* first run */ }
    const prevItem = job.items.find(i => i.name === name)
    if (prevItem) { prevItem.action = 'installing'; prevItem.present = false; prevItem.detail = '' } else job.items.push(item)
    job.updatedAt = new Date().toISOString()
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2))
  } catch { /* status file is best-effort */ }

  try {
    const child = spawn('bash', ['-c', `bash ${path.join(BASE, 'scripts', tc.setup)} >> ${logPath} 2>&1; code=$?; echo $code > ${donePath}; exit $code`], {
      cwd: BASE, detached: true, stdio: 'ignore', env: { ...process.env, PATH: process.env.PATH },
    })
    child.on('error', () => { item.action = 'failed'; item.detail = 'spawn failed' })
    child.unref()
    fs.writeFileSync(pidPath, String(child.pid || 0))
    item.action = 'installing'
    item.detail = `setup-${name}.sh running in the background (pid ${child.pid}) — poll GET /api/sdks for presence`
    return { started: true, item }
  } catch (e: any) {
    item.action = 'failed'
    item.detail = e?.message || 'spawn failed'
    return { started: false, item }
  }
}

/** Exported for tests / the SDK manager grid. */
export { MANAGED_TOOLCHAINS, RESERVED }
