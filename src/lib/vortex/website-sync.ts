/**
 * v149 — VORTEX WEBSITE MIRROR SYNC ("ভোর্টেক্স সার্ভার + ভোর্টেক্স ওয়েবসাইট
 * ক্লাউড এজেন্টের ভিতরে থাকবে, ক্লাউড এজেন্ট দিয়েই আপডেট হবে").
 *
 * The VORTEX website lives on disk at
 *   vortex-platform/website/vortex-website/   (static bundle: html/css/js/assets)
 *
 * syncVortexWebsite() copies that bundle to BOTH places, versioned:
 *   1. CloudAgent's own self-host store → served at /sites/vortex-website/
 *      by the agent's own server (the "inside the agent" copy)
 *   2. the VORTEX server's site hosting (:3200) → /sites/vortex-hub… there
 *      (via deploySiteToVortex, the same channel project publishes use)
 *
 * Idempotent, safe to call repeatedly; called by:
 *   - POST /api/admin/vortex { action:'update-website' } (owner's update button)
 *   - the /sites/vortex-website/ route (self-heal after a db wipe)
 *   - GET /api/admin/vortex (auto-seed when the mirror is missing)
 */
import fs from 'fs'
import path from 'path'
import { deploySite, collectSiteFilesFromStore } from '@/lib/selfhost'
import { deploySiteToVortex } from '@/lib/vortex/publish'

const BASE = process.env.PROJECT_ROOT || '/home/z/my-project'
const SITE_ROOT = path.join(BASE, 'vortex-platform', 'website', 'vortex-website')
export const VORTEX_MIRROR_SLUG = 'vortex-website'

const SKIP_DIRS = new Set(['node_modules', '.next', '.git'])
/** README/cloud-base.json are repo bookkeeping, not site payload. */
const SKIP_FILES = new Set(['README.md', 'cloud-base.json'])

function collectFiles(dir: string, base = '', out: { path: string; buf: Buffer }[] = []) {
  let entries: fs.Dirent[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.well-known') continue
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      collectFiles(path.join(dir, e.name), base ? `${base}/${e.name}` : e.name, out)
    } else if (e.isFile()) {
      if (SKIP_FILES.has(e.name)) continue
      try {
        out.push({ path: base ? `${base}/${e.name}` : e.name, buf: fs.readFileSync(path.join(dir, e.name)) })
      } catch { /* skip unreadable file */ }
    }
  }
  return out
}

export interface VortexWebsiteSyncResult {
  ok: boolean
  error?: string
  mirror?: { ok: boolean; version?: number; files?: number; bytes?: number; url?: string; error?: string }
  vortexHosting?: { ok: boolean; siteId?: string; url?: string; version?: number; error?: string }
}

export async function syncVortexWebsite(): Promise<VortexWebsiteSyncResult> {
  if (!fs.existsSync(path.join(SITE_ROOT, 'index.html'))) {
    return { ok: false, error: `VORTEX website bundle not found at ${SITE_ROOT}` }
  }
  const files = collectFiles(SITE_ROOT)
  if (!files.length) return { ok: false, error: 'VORTEX website bundle is empty' }

  // 1) mirror INSIDE CloudAgent (reserved slug — only this system sync may write)
  const mirror = await deploySite(VORTEX_MIRROR_SLUG, files, {
    name: 'VORTEX Website (system mirror)',
    ownerEmail: 'admin@vortex.local',
    system: true,
  })

  // 2) same payload → VORTEX server hosting (:3200) so the ecosystem's own
  //    site is live there too. Best-effort: the mirror alone already gives
  //    the owner a working site even when :3200 is mid-restart.
  let vortexHosting: VortexWebsiteSyncResult['vortexHosting']
  try {
    const hosted = await deploySiteToVortex('VORTEX Hub', files, 'admin@vortex.local')
    vortexHosting = hosted.ok
      ? { ok: true, siteId: hosted.siteId, url: hosted.url, version: hosted.version }
      : { ok: false, error: hosted.error }
  } catch (e: any) {
    vortexHosting = { ok: false, error: e?.message || 'vortex hosting unreachable' }
  }

  return mirror.ok ? { ok: true, mirror, vortexHosting } : { ok: false, error: mirror.error, mirror, vortexHosting }
}

/**
 * Self-heal entry point: sync ONLY when the CloudAgent mirror is missing
 * (fresh db / first boot). Returns null when nothing was needed.
 */
export async function ensureVortexWebsiteMirror(): Promise<VortexWebsiteSyncResult | null> {
  const { getSite } = await import('@/lib/selfhost')
  if (getSite(VORTEX_MIRROR_SLUG)) return null
  return syncVortexWebsite()
}

/** Re-export for callers that want to mirror the CURRENT store version to
 * the VORTEX server without re-reading the disk bundle. */
export function mirrorFilesFromStore(): { path: string; buf: Buffer }[] {
  return collectSiteFilesFromStore(VORTEX_MIRROR_SLUG)
}
