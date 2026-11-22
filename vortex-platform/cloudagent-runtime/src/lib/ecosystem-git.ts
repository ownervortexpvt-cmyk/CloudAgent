/**
 * ECOSYSTEM CODE HUB (v152) — self-hosted Git for the whole Vortex ecosystem.
 *
 * The owner asked: "ami admin panel theke token create kore jekonu editor diye
 * ei puro ecosystem ta update korte parbo ebong code push korte parbo" —
 * create tokens in the admin panel, push code from ANY editor, and the push
 * goes LIVE immediately (no Cloudflare, no Netlify, no external service).
 *
 * Architecture (everything lives inside the platform itself):
 *   bare repo      /home/z/my-project/vortex-git/vortex-ecosystem.git
 *   live tree      /home/z/my-project  (CloudAgent + VORTEX_SERVER + scripts)
 *   smart HTTP     /api/ecosystem-git/… (this repo's own server, token-gated)
 *   deploy         scripts/ecosystem-deploy.cjs — build + restart :3200,
 *                  NEVER resets data (db, uploads, projects survive every push)
 *
 * Tokens are stored in the UserSetting KV (same store as the admin lock) so
 * they survive restarts and self-heal like every other platform secret.
 * Only sha256(token) is stored — the plaintext is shown exactly once.
 */
import crypto from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import { db } from '@/lib/db'

export const ECOSYSTEM_REPO_DIR = '/home/z/my-project/vortex-git'
export const ECOSYSTEM_BARE = path.join(ECOSYSTEM_REPO_DIR, 'vortex-ecosystem.git')
export const ECOSYSTEM_LIVE = '/home/z/my-project'
export const ECOSYSTEM_TOKENS_KEY = 'ecosystem_git_tokens'
export const ECOSYSTEM_STATE_DIR = '/home/z/my-project/.ecosystem'
export const ECOSYSTEM_DEPLOY_STATE = path.join(ECOSYSTEM_STATE_DIR, 'deploy-state.json')
export const ECOSYSTEM_DEPLOY_HISTORY = path.join(ECOSYSTEM_STATE_DIR, 'deploy-history.json')
export const ECOSYSTEM_REPO_NAME = 'vortex-ecosystem.git'

export interface EcosystemToken {
  id: string
  name: string
  hash: string // sha256 hex of the plaintext token
  tail: string // last 6 chars for the masked UI
  createdAt: number
  lastUsedAt?: number
  lastUsedIp?: string
}

/* ─────────────────────────── token store ─────────────────────────── */

export function hashEcoToken(plain: string): string {
  return crypto.createHash('sha256').update(plain, 'utf8').digest('hex')
}

export function newEcoTokenPlain(): string {
  return `vxtok_${crypto.randomBytes(24).toString('hex')}`
}

async function readTokenRows(): Promise<EcosystemToken[]> {
  try {
    const row = await db.userSetting.findUnique({ where: { key: ECOSYSTEM_TOKENS_KEY } })
    if (!row?.value) return []
    const parsed = JSON.parse(row.value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeTokenRows(rows: EcosystemToken[]): Promise<void> {
  await db.userSetting.upsert({
    where: { key: ECOSYSTEM_TOKENS_KEY },
    update: { value: JSON.stringify(rows) },
    create: { key: ECOSYSTEM_TOKENS_KEY, value: JSON.stringify(rows) },
  })
}

export async function listEcoTokens(): Promise<Omit<EcosystemToken, 'hash'>[]> {
  const rows = await readTokenRows()
  return rows.map(({ hash, ...rest }) => rest)
}

/** Creates a token; the PLAINTEXT is returned exactly once and never stored. */
export async function createEcoToken(name: string): Promise<{ token: string; row: Omit<EcosystemToken, 'hash'> }> {
  const plain = newEcoTokenPlain()
  const row: EcosystemToken = {
    id: crypto.randomBytes(8).toString('hex'),
    name: String(name || 'editor').slice(0, 64),
    hash: hashEcoToken(plain),
    tail: plain.slice(-6),
    createdAt: Date.now(),
  }
  const rows = await readTokenRows()
  rows.push(row)
  await writeTokenRows(rows)
  const { hash, ...safe } = row
  return { token: plain, row: safe }
}

export async function revokeEcoToken(id: string): Promise<boolean> {
  const rows = await readTokenRows()
  const next = rows.filter((r) => r.id !== id)
  if (next.length === rows.length) return false
  await writeTokenRows(next)
  return true
}

/**
 * Verify a presented token (Basic password / header / query). Touches
 * lastUsed* for the UI. Timing-safe compare on the hash.
 */
export async function verifyEcoToken(
  plain: string | undefined | null,
  ip?: string,
): Promise<Omit<EcosystemToken, 'hash'> | null> {
  if (!plain || plain.length < 10) return null
  const candidate = Buffer.from(hashEcoToken(plain), 'hex')
  const rows = await readTokenRows()
  let matched: EcosystemToken | null = null
  for (const r of rows) {
    try {
      const stored = Buffer.from(r.hash, 'hex')
      if (stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate)) {
        matched = r
        break
      }
    } catch { /* malformed row */ }
  }
  if (!matched) return null
  const next = rows.map((r) =>
    r.id === matched!.id ? { ...r, lastUsedAt: Date.now(), lastUsedIp: ip || r.lastUsedIp } : r,
  )
  await writeTokenRows(next)
  const { hash, ...safe } = next.find((r) => r.id === matched!.id)!
  return safe
}

/** Extract a token from a git request: Basic auth, header, or ?token=. */
export function ecoTokenFromRequest(
  authHeader: string | null,
  headerToken: string | null,
  queryToken: string | null,
): string | null {
  if (authHeader?.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8')
      const idx = decoded.indexOf(':')
      const pass = idx >= 0 ? decoded.slice(idx + 1) : decoded
      if (pass) return pass
    } catch { /* fall through */ }
  }
  if (headerToken) return headerToken
  if (queryToken) return queryToken
  return null
}

/* ───────────────────── code browser safety rails ───────────────────── */

/** Dirs that are runtime data / build output / the git store itself — never
 * served by the Code Hub browser and never part of the pushed repo. */
export const ECOSYSTEM_BROWSER_EXCLUDES = [
  '.git', '.next', '.ecosystem', '.dev-watchdog.lock', '.secrets', '.wrangler',
  'node_modules', 'vortex-git', 'vortex-platform/server/VORTEX_SERVER/.next',
  'vortex-platform/server/VORTEX_SERVER/node_modules',
  'vortex-platform/server/VORTEX_SERVER/src/generated',
  'vortex-platform/server/VORTEX_SERVER/storage-pool',
  'vortex-platform/server/VORTEX_SERVER/db',
  'db', 'projects', 'upload', 'download', 'db-rescue', 'sdk', 'audit', 'bin',
  'tool-results', 'logs', 'out', 'build', 'mini-services/agent-service/node_modules',
]

/** File NAME patterns that must never be browsable — secrets, runtime
 * markers, logs, build junk. Also keeps the code browser clean. */
const HIDDEN_FILE_RE = new RegExp(
  [
    '^\\.env(\\.|$)', // secrets — never show, not even to the room
    '\\.log$', // runtime logs
    '\\.tsbuildinfo$', '\\.pid$',
    '\\.db$', '\\.sqlite(\\..*)?$', // binary runtime data
    '^\\.(prodmode|uptime-marker|vortex-build-marker|vortex-env-guard-ts|selfupdate-running|dev-watchdog\\.lock)$',
    '^MARKER2\\.txt$',
  ].join('|'),
)

/** Resolve a browser path inside the live tree; null = forbidden/missing. */
export function safeBrowserPath(rel: string): string | null {
  const clean = String(rel || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
  if (clean.includes('..') || clean.includes('\0')) return null
  const abs = path.resolve(ECOSYSTEM_LIVE, clean)
  if (abs !== ECOSYSTEM_LIVE && !abs.startsWith(ECOSYSTEM_LIVE + path.sep)) return null
  const norm = path.relative(ECOSYSTEM_LIVE, abs).split(path.sep).join('/')
  for (const ex of ECOSYSTEM_BROWSER_EXCLUDES) {
    if (norm === ex || norm.startsWith(ex + '/')) return null
  }
  // hidden-name check on every segment (files AND stray marker dirs)
  for (const seg of norm.split('/')) {
    if (HIDDEN_FILE_RE.test(seg)) return null
  }
  return abs
}

/* ────────────────────────── git helpers ────────────────────────── */

export interface EcosystemRepoInfo {
  ready: boolean
  branch: string
  head: string | null
  headSubject: string | null
  headDate: string | null
  trackedFiles: number
  repoSizeMB: number
}

export async function ecosystemRepoInfo(): Promise<EcosystemRepoInfo> {
  const empty: EcosystemRepoInfo = {
    ready: false, branch: 'main', head: null, headSubject: null,
    headDate: null, trackedFiles: 0, repoSizeMB: 0,
  }
  try {
    await fs.access(ECOSYSTEM_BARE)
  } catch {
    return empty
  }
  const { execFile } = await import('child_process')
  const g = (args: string[]): Promise<string> =>
    new Promise((resolve) => {
      execFile('git', ['--git-dir', ECOSYSTEM_BARE, ...args], { timeout: 15000 }, (err, stdout) => {
        resolve(err ? '' : String(stdout || '').trim())
      })
    })
  const head = await g(['rev-parse', 'HEAD'])
  if (!head) return empty
  const [subject, date, filesOut, duOut] = await Promise.all([
    g(['log', '-1', '--format=%s']),
    g(['log', '-1', '--format=%cI']),
    g(['ls-files']),
    new Promise<string>((resolve) => {
      execFile('du', ['-sm', ECOSYSTEM_BARE], { timeout: 15000 }, (err, stdout) => {
        resolve(err ? '0' : String(stdout || '0').split('\t')[0])
      })
    }),
  ])
  const files = filesOut ? filesOut.split('\n').filter(Boolean).length : 0
  return {
    ready: true,
    branch: 'main',
    head,
    headSubject: subject || null,
    headDate: date || null,
    trackedFiles: files,
    repoSizeMB: Number(duOut) || 0,
  }
}

/** Public origin (preview URL etc.) the request came through. */
export function publicOrigin(host: string | null, proto: string | null): string {
  return `${proto || 'https'}://${host || 'localhost:3000'}`
}

export function cloneUrlFor(origin: string): string {
  return `${origin}/api/ecosystem-git/${ECOSYSTEM_REPO_NAME}`
}
