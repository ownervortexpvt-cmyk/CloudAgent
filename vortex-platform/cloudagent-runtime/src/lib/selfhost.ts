/**
 * v149 — CLOUDAGENT SELF-HOSTING (owner request: "publish inside the agent
 * itself — not through any external cloud website").
 *
 * The last missing piece of the zero-external-cloud story: CloudAgent now IS
 * the hosting platform. A published site lands in the agent's own disk store
 * and is served by the agent's own web server at /sites/<siteId>/… — no
 * Vercel, no Netlify, no Cloudflare, nothing outside this box.
 *
 * Layout (survives restarts, wiped only if db/ is wiped — same risk class as
 * every other CloudAgent store; the watchdog already heals the DB the same way):
 *   db/selfhost/registry.json            → site index (atomic writes)
 *   db/selfhost/<siteId>/v<N>/…          → immutable version directories
 *
 * The registry keeps the last 5 versions per site on disk; older versions
 * are pruned after a successful deploy (rollback window, not an archive).
 *
 * Reserved slug "vortex-website": the VORTEX WEBSITE platform site mirrored
 * INSIDE CloudAgent (see /api/admin/vortex → update-website). User publishes
 * can never overwrite it; only the system sync may write there.
 */
import fs from 'fs'
import path from 'path'

const BASE = process.env.PROJECT_ROOT || '/home/z/my-project'
const STORE = path.join(BASE, 'db', 'selfhost')
const REGISTRY = path.join(STORE, 'registry.json')
const MAX_VERSIONS_ON_DISK = 5
export const RESERVED_SLUGS = ['vortex-website'] as const

export interface SelfHostSite {
  siteId: string
  name: string
  ownerEmail: string
  activeVersion: number
  createdAt: string
  updatedAt: string
  lastBytes: number
  lastFiles: number
  system?: boolean // reserved/system-owned site (vortex-website mirror)
}

interface Registry {
  sites: SelfHostSite[]
}

/* ─── registry IO (atomic: tmp file + rename) ─── */

function readRegistry(): Registry {
  try {
    const raw = fs.readFileSync(REGISTRY, 'utf8')
    const reg = JSON.parse(raw) as Registry
    if (reg && Array.isArray(reg.sites)) return reg
  } catch { /* first run or torn write — start fresh */ }
  return { sites: [] }
}

function writeRegistry(reg: Registry): void {
  fs.mkdirSync(STORE, { recursive: true })
  const tmp = REGISTRY + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 1))
  fs.renameSync(tmp, REGISTRY)
}

/* ─── slug rules ─── */

export function slugify(input: string): string {
  const s = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return s || 'site'
}

/** Deterministic short suffix so identical names from different projects
 * never collide (same pattern the VORTEX WEBSITE platform uses). */
export function slugWithSuffix(name: string, seed: string): string {
  let h = 0
  for (const ch of String(seed || 'x')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `${slugify(name)}.${h.toString(36).slice(0, 4)}`
}

export function getSite(siteId: string): SelfHostSite | null {
  const reg = readRegistry()
  return reg.sites.find((s) => s.siteId === String(siteId).toLowerCase()) || null
}

export function listSites(): SelfHostSite[] {
  return readRegistry().sites.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
}

/* ─── deploy ─── */

export interface DeployFile {
  path: string
  buf: Buffer
}

export interface DeployResult {
  ok: boolean
  error?: string
  siteId?: string
  version?: number
  files?: number
  bytes?: number
  url?: string
}

/**
 * Deploy an immutable version. System sync (reserved slugs) passes
 * `system: true`; that is the ONLY way to write a reserved site.
 */
export async function deploySite(
  siteId: string,
  files: DeployFile[],
  opts: { name?: string; ownerEmail?: string; system?: boolean } = {},
): Promise<DeployResult> {
  const id = String(siteId).toLowerCase()
  if (!id || /[^\w.-]/.test(id) || id.startsWith('.') || id.includes('..')) {
    return { ok: false, error: `invalid site id: ${id}` }
  }
  if (RESERVED_SLUGS.includes(id as (typeof RESERVED_SLUGS)[number]) && !opts.system) {
    return { ok: false, error: `"${id}" is a reserved system site — it is owned by CloudAgent itself` }
  }
  if (!files.length) return { ok: false, error: 'no files to deploy' }
  // path safety before anything touches the disk
  for (const f of files) {
    if (!f.path || f.path.includes('..') || f.path.startsWith('/') || f.path.includes('\\')) {
      return { ok: false, error: `unsafe file path: ${String(f.path).slice(0, 80)}` }
    }
  }

  const reg = readRegistry()
  let site = reg.sites.find((s) => s.siteId === id)
  const isFirst = !site
  if (isFirst) {
    site = {
      siteId: id,
      name: opts.name?.slice(0, 80) || id,
      ownerEmail: opts.ownerEmail?.slice(0, 120) || 'cloud-agent@vortex.local',
      activeVersion: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastBytes: 0,
      lastFiles: 0,
      system: opts.system || undefined,
    }
    reg.sites.push(site)
  }
  const cur = site as SelfHostSite
  const version = (cur.activeVersion || 0) + 1
  const dir = path.join(STORE, id, `v${version}`)
  fs.mkdirSync(dir, { recursive: true })

  let bytes = 0
  try {
    for (const f of files) {
      const dst = path.join(dir, f.path)
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      fs.writeFileSync(dst, f.buf)
      bytes += f.buf.length
    }
    // marker so a torn deploy (crash mid-write) can be detected
    fs.writeFileSync(path.join(dir, '.deploy-ok'), version.toString())
  } catch (e: any) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* cleanup best-effort */ }
    return { ok: false, error: `write failed: ${e?.message || 'unknown'}` }
  }

  // prune old versions beyond the rollback window
  const all = fs.existsSync(path.join(STORE, id))
    ? fs.readdirSync(path.join(STORE, id)).filter((d) => /^v\d+$/.test(d)).map((d) => Number(d.slice(1)))
    : []
  for (const v of all.sort((a, b) => b - a).slice(MAX_VERSIONS_ON_DISK)) {
    try { fs.rmSync(path.join(STORE, id, `v${v}`), { recursive: true, force: true }) } catch { /* best-effort */ }
  }

  cur.activeVersion = version
  cur.updatedAt = new Date().toISOString()
  cur.lastBytes = bytes
  cur.lastFiles = files.length
  if (opts.name) cur.name = opts.name.slice(0, 80)
  if (!isFirst && opts.system) cur.system = true
  writeRegistry(reg)

  return {
    ok: true,
    siteId: id,
    version,
    files: files.length,
    bytes,
    url: `/sites/${id}/`,
  }
}

/* ─── read (serving side) ─── */

/** Read one file from the ACTIVE version of a site. Returns null when the
 * site/version/file does not exist — the route turns that into 404. */
export function getSiteFile(siteId: string, relPath: string): Buffer | null {
  const site = getSite(siteId)
  if (!site || site.activeVersion < 1) return null
  // relPath === '' is VALID here (the route's "site root" case → index.html);
  // only traversal / absolute escapes are rejected.
  if (relPath.includes('..') || relPath.startsWith('/')) return null
  const dir = path.join(STORE, site.siteId, `v${site.activeVersion}`)
  const candidates = relPath
    ? [relPath, `${relPath}/index.html`, `${relPath}.html`]
    : ['index.html']
  for (const c of candidates) {
    try {
      const st = fs.statSync(path.join(dir, c))
      if (st.isFile()) return fs.readFileSync(path.join(dir, c))
    } catch { /* try next candidate */ }
  }
  return null
}

export function siteStoreRoot(siteId: string): string {
  return path.join(STORE, siteId, `v${getSite(siteId)?.activeVersion || 0}`)
}

/** Collect every file of the ACTIVE version (used to mirror a site to the
 * VORTEX server hosting). Empty array when the site does not exist. */
export function collectSiteFilesFromStore(siteId: string): DeployFile[] {
  const dir = siteStoreRoot(siteId)
  const out: DeployFile[] = []
  const walk = (d: string, base: string) => {
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const rel = base ? `${base}/${e.name}` : e.name
      if (rel.endsWith('/.deploy-ok') || e.name === '.deploy-ok') continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p, rel)
      else if (e.isFile()) {
        try { out.push({ path: rel, buf: fs.readFileSync(p) }) } catch { /* skip unreadable */ }
      }
    }
  }
  walk(dir, '')
  return out
}
