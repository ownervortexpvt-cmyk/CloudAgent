/**
 * v153 — DYNAMIC SITEMAP for the Vortex Cloud Agent platform.
 *
 * Generated from the REQUEST HOST at serve time — the platform never
 * hardcodes any gateway/preview URL anywhere (owner requirement: zero
 * platform-vendor branding baked into the app). Crawlers (Googlebot,
 * Bingbot) reach this without a session: /sitemap.xml is public in the
 * middleware (PUBLIC_PATHS + GATE_PUBLIC) and leaks zero data — it lists
 * only the public marketing/legal/auth entry pages.
 */
import { NextRequest } from 'next/server'

const PUBLIC_ENTRIES = [
  '/',
  '/landing',
  '/login',
  '/register',
  '/pricing',
  '/terms',
  '/privacy',
  '/refund',
  '/contact',
]

export async function GET(req: NextRequest) {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || ''
  const proto = req.headers.get('x-forwarded-proto') || (host?.startsWith('localhost') || host?.startsWith('127.') ? 'http' : 'https')
  const base = host ? `${proto}://${host}` : ''
  const now = new Date().toISOString().slice(0, 10)
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PUBLIC_ENTRIES.map((p) => `  <url><loc>${base}${p}</loc><lastmod>${now}</lastmod><changefreq>weekly</changefreq></url>`).join('\n')}
</urlset>`
  return new Response(body, {
    headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' },
  })
}
