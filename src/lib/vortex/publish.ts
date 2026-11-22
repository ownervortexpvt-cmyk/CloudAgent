/**
 * VORTEX ECOSYSTEM integration for CLOUD AGENT.
 *
 * Talks to the VORTEX SERVER central infrastructure (:3200 in dev):
 *   - vortex-website namespace  → deploy static sites (site → files → versioned deploy)
 *   - appverse namespace        → publish APK/AAB (upload → review gate → distribution)
 *   - cloud-agent namespace     → source + build archive to the central vault
 *   - vaas public SDK (/api/vaas/v1/*) → per-app backend provisioning (auth+OTP, data, storage)
 *
 * Auth: platform keys issued once from the VORTEX SERVER dashboard. Each key is
 * scoped to exactly ONE platform namespace (isolation by design), so this module
 * holds three keys. Honest failure when the ecosystem is not wired.
 */
import fs from 'fs'
import path from 'path'

const SERVER_URL = (process.env.VORTEX_SERVER_URL || 'http://127.0.0.1:3200').replace(/\/+$/, '')

export function vortexConfigured(): boolean {
  return Boolean(process.env.VORTEX_PLATFORM_KEY)
}

type JsonRes = { ok?: boolean; data?: any; error?: string }

async function vxApi(path: string, body: unknown, keyEnv: 'VORTEX_PLATFORM_KEY' | 'VORTEX_WEBSITE_KEY' | 'VORTEX_APPVERSE_KEY', method: 'GET' | 'POST' = 'POST', timeoutMs = 120_000): Promise<JsonRes> {
  const key = process.env[keyEnv]
  if (!key) return { ok: false, error: `VORTEX key missing (${keyEnv}) — issue it from the VORTEX SERVER dashboard → SERVER → APIs` }
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(SERVER_URL + path, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    })
    const json = await res.json().catch(() => ({}) as JsonRes)
    if (!res.ok || json?.ok === false) return { ok: false, error: json?.error || `VORTEX SERVER HTTP ${res.status}` }
    return { ok: true, data: json?.data ?? json }
  } catch (e: any) {
    return { ok: false, error: `VORTEX SERVER unreachable (${e?.message || e})` }
  } finally {
    clearTimeout(t)
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'site'
}

/** Collect static-site files (path → Buffer) from a project root, honouring the framework's output dir. */
export function collectSiteFiles(projectRoot: string, outDir?: string, capBytes = 24 * 1024 * 1024): { files: { path: string; buf: Buffer }[]; totalBytes: number } {
  const walkRoot = outDir && outDir !== '.' ? path.join(projectRoot, outDir) : projectRoot
  const files: { path: string; buf: Buffer }[] = []
  let totalBytes = 0
  const skipTop = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.cache'])
  const walk = (dir: string, base = '') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (base === '' && skipTop.has(e.name)) continue
      const full = path.join(dir, e.name)
      const rel = base ? `${base}/${e.name}` : e.name
      if (e.isDirectory()) walk(full, rel)
      else {
        const buf = fs.readFileSync(full)
        totalBytes += buf.length
        if (totalBytes <= capBytes) files.push({ path: rel, buf })
      }
    }
  }
  if (fs.existsSync(walkRoot)) walk(walkRoot)
  return { files, totalBytes }
}

// ---------------------------------------------------------------------------
// VORTEX WEBSITE — static site deployment
// ---------------------------------------------------------------------------

export interface SiteDeployResult {
  ok: boolean
  error?: string
  siteId?: string
  url?: string
  version?: number
  files?: number
  sizeBytes?: number
  log?: string
}

/**
 * Deploy a static site: create the site (or reuse by subdomain), upload files
 * to the draft, trigger the versioned deploy. Idempotent per siteName —
 * repeat publishes create a NEW VERSION of the same site.
 */
export async function deploySiteToVortex(siteName: string, files: { path: string; buf: Buffer }[], ownerEmail: string): Promise<SiteDeployResult> {
  if (!files.length) return { ok: false, error: 'no files to deploy' }
  if (!files.some(f => f.path === 'index.html')) return { ok: false, error: 'index.html missing — a deployable site needs one' }
  const sub = slugify(siteName)
  // reuse an existing site with the same owner+subdomain when possible
  const list = await vxApi('/api/v1/vortex-website/sites', undefined, 'VORTEX_WEBSITE_KEY', 'GET')
  let siteId: string | undefined
  if (list.ok && Array.isArray(list.data?.sites)) {
    const existing = list.data.sites.find((s: any) => s.subdomain === `${sub}.vortex.site` || s.subdomain?.startsWith(`${sub}.`))
    if (existing) siteId = existing.siteId
  }
  if (!siteId) {
    const created = await vxApi('/api/v1/vortex-website/sites', { name: siteName, subdomain: sub, ownerEmail }, 'VORTEX_WEBSITE_KEY')
    if (!created.ok) return { ok: false, error: created.error }
    siteId = created.data?.siteId
  }
  if (!siteId) return { ok: false, error: 'site id missing after create' }
  const up = await vxApi(`/api/v1/vortex-website/sites/${siteId}/files`, {
    files: files.map(f => ({ path: f.path, contentB64: f.buf.toString('base64') })),
  }, 'VORTEX_WEBSITE_KEY')
  if (!up.ok) return { ok: false, error: up.error, siteId }
  const dep = await vxApi(`/api/v1/vortex-website/sites/${siteId}/deploy`, {}, 'VORTEX_WEBSITE_KEY')
  if (!dep.ok) return { ok: false, error: dep.error, siteId }
  return {
    ok: true,
    siteId,
    url: dep.data?.url,
    version: dep.data?.version,
    files: dep.data?.files,
    sizeBytes: dep.data?.sizeBytes,
  }
}

// ---------------------------------------------------------------------------
// APPVERSE — APK/AAB publishing with review gate
// ---------------------------------------------------------------------------

export interface AppversePublishResult {
  ok: boolean
  error?: string
  appId?: string
  versionId?: string
  version?: string
  status?: string
  sha256?: string
  sizeBytes?: number
  log?: string
}

/**
 * Publish a built APK/AAB to APPVERSE. Registers the app (packageName unique)
 * and uploads the binary version; the version lands PENDING review — the owner
 * approves it from the VORTEX SERVER dashboard (APPVERSE → review).
 */
export async function publishAppToAppverse(opts: {
  name: string
  packageName: string
  version: string
  kind: 'APK' | 'AAB'
  binaryPath: string
  description?: string
  changelog?: string
  developerId?: string
}): Promise<AppversePublishResult> {
  const bin = fs.existsSync(opts.binaryPath) ? fs.readFileSync(opts.binaryPath) : null
  if (!bin || bin.length === 0) return { ok: false, error: `binary missing: ${opts.binaryPath}` }
  // find or create the app
  const list = await vxApi('/api/v1/appverse/apps', undefined, 'VORTEX_APPVERSE_KEY', 'GET')
  let appId: string | undefined
  if (list.ok && Array.isArray(list.data?.apps)) {
    const existing = list.data.apps.find((a: any) => a.packageName === opts.packageName)
    if (existing) appId = existing.appId
  }
  if (!appId) {
    const created = await vxApi('/api/v1/appverse/apps', {
      name: opts.name, packageName: opts.packageName,
      category: 'general', description: opts.description || `Built with CLOUD AGENT`,
      developerId: opts.developerId,
    }, 'VORTEX_APPVERSE_KEY')
    if (!created.ok) return { ok: false, error: created.error }
    appId = created.data?.appId
  }
  if (!appId) return { ok: false, error: 'appId missing after create' }
  const up = await vxApi(`/api/v1/appverse/apps/${appId}/versions`, {
    version: opts.version, kind: opts.kind, contentB64: bin.toString('base64'),
    changelog: opts.changelog || `CLOUD AGENT build ${new Date().toISOString()}`,
  }, 'VORTEX_APPVERSE_KEY', 'POST', 300_000)
  if (!up.ok) return { ok: false, error: up.error, appId }
  return {
    ok: true, appId,
    versionId: up.data?.versionId, version: up.data?.version,
    status: up.data?.status, sha256: up.data?.sha256, sizeBytes: up.data?.sizeBytes,
  }
}

// ---------------------------------------------------------------------------
// VaaS — per-app backend provisioning (auth+OTP / data / storage)
// ---------------------------------------------------------------------------

export interface VaasProvisionResult {
  ok: boolean
  error?: string
  projectId?: string
  clientKey?: string
  adminKey?: string
  collections?: string[]
  snippet?: string
  baseUrl?: string
}

/**
 * Provision a Firebase-style backend for a generated app: project +
 * collections + CLIENT/ADMIN keys + a ready-to-paste SDK snippet.
 * Uses the builder developer identity (nexa@vortex.local) via the public
 * /api/vaas/v1/dev/* flow — no dashboard session needed.
 * Contract: vxOk() spreads data at top level ({ ok, token, projectId, ... }).
 */
export async function provisionVaasBackend(appName: string, collections: string[]): Promise<VaasProvisionResult> {
  const email = process.env.VORTEX_VAAS_DEV_EMAIL || 'nexa@vortex.local'
  const password = process.env.VORTEX_VAAS_DEV_PASSWORD
  if (!password) {
    return { ok: false, error: 'VORTEX_VAAS_DEV_PASSWORD missing — set the builder developer password in CloudAgent .env' }
  }
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 60_000)
  try {
    const login = await fetch(SERVER_URL + '/api/vaas/v1/dev/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }), signal: ctl.signal,
    })
    const lj = await login.json().catch(() => ({} as any))
    const token = lj?.token
    if (!login.ok || lj?.ok === false || !token) return { ok: false, error: lj?.error || `VaaS dev login failed (HTTP ${login.status})` }
    const proj = await fetch(SERVER_URL + '/api/vaas/v1/dev/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: appName, collections }), signal: ctl.signal,
    })
    const pj = await proj.json().catch(() => ({} as any))
    if (!proj.ok || pj?.ok === false) return { ok: false, error: pj?.error || `VaaS provision failed (HTTP ${proj.status})` }
    return {
      ok: true,
      projectId: pj.projectId,
      clientKey: pj.clientKey,
      adminKey: pj.adminKey,
      collections,
      snippet: pj.snippet,
      baseUrl: SERVER_URL,
    }
  } catch (e: any) {
    return { ok: false, error: `VaaS unreachable (${e?.message || e})` }
  } finally {
    clearTimeout(t)
  }
}
