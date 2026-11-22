import { NextResponse } from 'next/server'
import { getSite, getSiteFile, RESERVED_SLUGS } from '@/lib/selfhost'
import { ensureVortexWebsiteMirror } from '@/lib/vortex/website-sync'

/**
 * v149 — CLOUDAGENT'S OWN STATIC SITE SERVER (public, no auth).
 *
 * Every "Self-Host (CloudAgent)" publish and the mirrored VORTEX website are
 * served HERE — from the agent's own disk, by the agent's own web server:
 *   GET /sites/<siteId>/            → index.html
 *   GET /sites/<siteId>/<file>      → that file
 *   GET /sites/<siteId>/<dir>/      → <dir>/index.html
 *
 * Self-heal: the reserved "vortex-website" mirror is re-synced automatically
 * the first time it is requested after a db wipe (same discipline as the
 * admin-lock / vortex .env self-heals — nothing stays broken on this box).
 */
export const dynamic = 'force-dynamic'

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  mjs: 'application/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  wasm: 'application/wasm',
}

function contentTypeOf(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase() || ''
  return MIME[ext] || 'application/octet-stream'
}

export async function GET(req: Request, ctx: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await ctx.params
  const siteId = (slug?.[0] || '').toLowerCase()
  const rel = (slug?.slice(1) || []).map((p) => decodeURIComponent(p)).join('/')
  if (!siteId) return new NextResponse('Site not found', { status: 404 })

  // reserved-site self-heal: first request after a wipe rebuilds the mirror
  if (RESERVED_SLUGS.includes(siteId as (typeof RESERVED_SLUGS)[number]) && !getSite(siteId)) {
    await ensureVortexWebsiteMirror().catch(() => null)
  }

  const buf = getSiteFile(siteId, rel)
  if (!buf) return new NextResponse('File not found', { status: 404 })

  const site = getSite(siteId)
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': contentTypeOf(rel || 'index.html'),
      'Cache-Control': 'public, max-age=60',
      // v158 stealth (owner: "users must never detect the cloud editor"):
      // the old X-CA-* names fingerprinted the platform on every public
      // response. Neutral CDN-style names only; no editor/agent strings.
      'X-Site-Id': siteId,
      'X-Site-Version': String(site?.activeVersion || 0),
    },
  })
}
