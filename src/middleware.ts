/**
 * BUSINESS v2 — user-session middleware (replaces the owner PIN lock).
 *
 * Every page and API requires a signed-in AuthUser session, except:
 *   /login, /register, /pricing      the public auth + marketing pages
 *   /api/auth/*                      register / login / logout themselves
 *   published-site plumbing: gateway lookup, anonymous analytics beacon,
 *   the token-guarded backup download (route enforces its own two gates)
 *
 * Token channels (same transport the lock used, so the frontend fetch layer
 * is untouched): `ca_session` cookie OR `x-ca-lock` header (LockTokenBridge).
 */
import { NextRequest, NextResponse } from 'next/server'
import { sha256Hex, tokenFromRequest, verifySession } from '@/lib/auth'
import { db } from '@/lib/db'
import { getControlFlags, type ControlFlags as ControlFlagsShape } from '@/lib/app-control'
import { getGate, checkGate, GATE_COOKIE, GATE_HEADER } from '@/lib/gate'
import { resolveSiteHost } from '@/lib/custom-domains'

const DEFAULT_FLAGS: ControlFlagsShape = {
  maintenance: false,
  maintenanceMessage: 'CloudAgent is getting a quick upgrade — back in a few minutes.',
  siteOpen: true,
}

const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/pricing',
  // v110 public marketing + legal pages (Razorpay India KYC needs these live):
  '/landing',
  '/terms',
  '/privacy',
  '/refund',
  '/contact',
  '/api/auth/',
  // v153 — SEO: crawlers (Googlebot/Bingbot) must reach robots.txt + sitemap
  // WITHOUT a session — they can never log in. Both files leak zero data.
  '/robots.txt',
  '/sitemap.xml',
  // v110 Razorpay server-to-server events (HMAC-verified inside the route)
  '/api/billing/webhook',
  '/api/custom-domains/lookup',
  '/api/analytics/hit',
  // public PATH but never open access: the route demands a 24h one-active
  // token (?token=) OR normal auth. Exists so a plain browser LINK can
  // download the backup (links can't send the x-ca-lock header).
  '/api/backup-download',
  // v116 — the maintenance page itself (rewritten-to when the switch is on)
  '/maintenance',
  // builder PWA assets — fetched on every page including /login; no owner data
  '/manifest.webmanifest',
  '/sw-builder.js',
  '/icon.svg',
  '/logo.svg',
  '/builder-icon-512.png',
  // v117.2 — build-version probe for the "New version available" banner:
  // must work for signed-out users too (returns only a build id, zero data)
  '/api/version',
  // v149 — CloudAgent's OWN published-site server (/sites/<slug>/…): a
  // published site is PUBLIC by definition (same contract as the VORTEX
  // server's /sites/<sub>/). Serving static files the owner chose to
  // publish; no session data behind these paths.
  '/sites/',
  // v119 — anonymous invite-code check for the login-screen banner
  // (leaks only a masked first name, rate-limited, unknown codes 404)
  '/api/referral/lookup',
  // v152 — Ecosystem Code Hub git transport: PUBLIC at the middleware level
  // because git clients cannot carry the session cookie — the ROUTE enforces
  // its own ecosystem-token gate (Basic password / header / ?token=) on
  // every request, same contract as /api/backup-download.
  '/api/ecosystem-git',
]

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p))
}

/**
 * v123 — PRIVATE SITE GATE bypass list. Everything else (pages AND APIs)
 * needs the gate cookie / x-ca-gate header BEFORE anything else is checked.
 * Only the gate's own plumbing + the PWA shell + the build probe pass free.
 */
const GATE_PUBLIC = [
  '/gate',
  '/api/gate',
  '/api/version',
  '/manifest.webmanifest',
  '/sw-builder.js',
  '/icon.svg',
  '/logo.svg',
  '/builder-icon-512.png',
  // published-site + payment plumbing — public paths that must survive the gate:
  '/api/custom-domains/lookup',
  '/api/billing/webhook',
  '/api/analytics/hit',
  // v149 — CloudAgent's own /sites/ server: published sites stay reachable
  // even when the gate wall is up (they are already public artifacts).
  '/sites/',
  // v152 — git transport: token-gated inside the route (see above)
  '/api/ecosystem-git',
  // v153 — crawler plumbing stays public even behind the private gate
  '/robots.txt',
  '/sitemap.xml',
]

function gatePublic(pathname: string): boolean {
  return GATE_PUBLIC.some((p) => pathname === p || pathname.startsWith(p))
}

/**
 * v116 — MAINTENANCE MODE. When the owner flips the switch in the secret
 * control room, EVERYTHING shows a maintenance page — except this bypass
 * list (the owner's own control room, auth plumbing, the Razorpay webhook
 * so payments keep activating, and static shell assets).
 */
const MAINTENANCE_BYPASS = [
  '/maintenance',
  '/admin',
  '/api/admin',
  '/api/auth',
  '/api/billing/webhook',
  '/api/analytics/hit',
  '/api/backup-download',
  '/api/custom-domains/lookup',
  '/manifest.webmanifest',
  '/sw-builder.js',
  '/icon.svg',
  '/logo.svg',
  '/builder-icon-512.png',
  // v152 — owner pushing code must work even during maintenance mode
  '/api/ecosystem-git',
]

function maintenanceBypassed(pathname: string): boolean {
  return MAINTENANCE_BYPASS.some((p) => pathname === p || pathname.startsWith(p))
}

/**
 * v162 — AUTO-BACK FIX: the old middleware redirected to /login (or crashed)
 * on the FIRST transient DB hiccup — SQLite busy during a dev compile, a
 * momentary WAL lock, a slow boot — and a logged-in user suddenly found
 * themselves "automatically back" on /login or /gate. Now:
 *   1. every DB touch is wrapped — a hiccup can never crash the middleware
 *   2. session verification retries ONCE after 350ms (SQLITE_BUSY heals in ms)
 *   3. flags/gate errors fail toward "allow" for the wall layers — the SESSION
 *      wall (the real data boundary) still runs right after and protects APIs.
 */
async function safeControlFlags(): Promise<ControlFlagsShape> {
  try { return await getControlFlags() } catch {
    return DEFAULT_FLAGS
  }
}

async function verifySessionWithRetry(req: NextRequest) {
  try {
    return { ok: true as const, user: await verifySession(tokenFromRequest(req)) }
  } catch (e1) {
    // one quick retry — transient SQLite busy (dev compile, WAL lock) heals in ms
    await new Promise((r) => setTimeout(r, 350))
    try {
      return { ok: true as const, user: await verifySession(tokenFromRequest(req)) }
    } catch (e2) {
      return { ok: false as const, err: e2 }
    }
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // capture the PUBLIC host (once per process) for honest clickable links
  const g = globalThis as unknown as { __caHostLogged?: string }
  const fwdHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || ''
  if (fwdHost && !fwdHost.startsWith('localhost') && !fwdHost.startsWith('127.') && g.__caHostLogged !== fwdHost) {
    g.__caHostLogged = fwdHost
    const proto = req.headers.get('x-forwarded-proto') || 'http'
    console.log(`[public-host] ${proto}://${fwdHost}`)
  }

  if (pathname.startsWith('/_next') || pathname === '/favicon.ico') return NextResponse.next()
  // legacy owner-lock bookmark → the login screen
  if (pathname === '/lock') {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }

  // ── v123 — CUSTOM-DOMAIN SITE SERVING (before gate/session/maintenance) ──
  // A verified custom-domain host IS a user's published site: the whole world
  // may see it, so it must never hit the private gate or the session wall.
  // Both forms are handled: /  →  /preview/<port>/   and any direct hit on
  // /preview/<port>/… passes straight through (the preview proxy serves it).
  try {
    const site = await resolveSiteHost(fwdHost)
    if (site && site.port) {
      const prefix = `/preview/${site.port}/`
      if (pathname.startsWith(`/preview/${site.port}/`) || pathname === `/preview/${site.port}`) {
        return NextResponse.next()
      }
      const url = req.nextUrl.clone()
      url.pathname = prefix + pathname.replace(/^\//, '')
      url.protocol = 'http:' // v162.1 — forwarded https made Next treat the rewrite as cross-origin and proxy it with a broken TLS scheme
      return NextResponse.rewrite(url)
    }
  } catch { /* resolver hiccup → continue as builder traffic */ }

  // ── v123 — PRIVATE SITE GATE ("atar access shudhu apnar are amar modyei") ──
  // The outermost shell of the BUILDER: no page or API answers without the
  // private key. Published custom-domain sites passed above — they are public
  // by definition.
  if (!gatePublic(pathname)) {
    // v135 — SITE OPEN switch (control room): when ON, ordinary users walk
    // straight in — register → pay → dashboard, no access-code wall, and
    // Big Billion Day stays free. When the owner flips it OFF, the private
    // gate returns exactly as before.
    const flags = await safeControlFlags()
    if (!flags.siteOpen) {
      let gate: Awaited<ReturnType<typeof getGate>> | null = null
      try { gate = await getGate() } catch { /* DB hiccup → do not brick the site */ }
      if (gate) {
        const presented = req.cookies.get(GATE_COOKIE)?.value || req.headers.get(GATE_HEADER) || undefined
        if (!checkGate(presented, gate)) {
          if (pathname === '/api' || pathname.startsWith('/api/')) {
            return NextResponse.json(
              { ok: false, error: 'this site is private — access key required', limit: 'gate' },
              { status: 401 }
            )
          }
          const u = req.nextUrl.clone()
          u.pathname = '/gate'
          u.search = ''
          return NextResponse.redirect(u)
        }
      }
    }
  } else {
    // gate plumbing itself (/gate, /api/gate, PWA shell, version probe) —
    // public by design, skip the session wall entirely
    return NextResponse.next()
  }

  // v116 — MAINTENANCE KILL-SWITCH (control room). 30s-cached flags keep this
  // free on hot paths; the owner (role=admin) always passes, the Razorpay
  // webhook keeps working, everyone else sees the maintenance screen.
  const controlFlags = await safeControlFlags()
  if (controlFlags.maintenance && !maintenanceBypassed(pathname)) {
    try {
      const adminUser = await verifySession(tokenFromRequest(req))
      if (adminUser?.role === 'admin') return NextResponse.next()
    } catch { /* DB hiccup → treat as non-admin; maintenance page still renders */ }
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { ok: false, error: controlFlags.maintenanceMessage, limit: 'maintenance' },
        { status: 503, headers: { 'Retry-After': '60' } }
      )
    }
    const mUrl = req.nextUrl.clone()
    mUrl.pathname = '/maintenance'
    mUrl.search = ''
    mUrl.protocol = 'http:' // v162.1 — same cross-origin proxy guard for the maintenance rewrite
    return NextResponse.rewrite(mUrl)
  }

  if (isPublicPath(pathname)) return NextResponse.next()

  const presentedToken = tokenFromRequest(req)
  const vr = await verifySessionWithRetry(req)
  if (vr.ok) {
    if (vr.user) return NextResponse.next()
  } else {
    console.error('[auth-middleware] DB unavailable — failing closed with 503:', (vr.err as any)?.message || vr.err)
  }
  if (!vr.ok || !vr.user) {
    const dbDown = !vr.ok
    if (dbDown && pathname === '/') {
      // the landing page is static — it still works when the DB is down
      const url = req.nextUrl.clone()
      url.pathname = '/landing'
      url.search = ''
      url.protocol = 'http:' // v162.1 — forwarded https made Next treat the rewrite as cross-origin and proxy it with a broken TLS scheme
      return NextResponse.rewrite(url)
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      if (dbDown) {
        return NextResponse.json(
          { ok: false, error: 'temporarily unavailable — the database is not answering (server busy or restarting). Try again in a moment.' },
          { status: 503, headers: { 'Retry-After': '2' } }
        )
      }
      const res = NextResponse.json({ ok: false, error: 'signed out — please log in' }, { status: 401 })
      if (presentedToken) res.headers.set('x-ca-lock-revoked', '1')
      return res
    }
    if (dbDown && pathname !== '/') {
      // v162: transient DB outage mid-browse must NOT bounce a signed-in user
      // to /login (the "automatic back" bug). Serve the static landing instead;
      // the session cookie is untouched — a refresh lands them back where they were.
      const url = req.nextUrl.clone()
      url.pathname = '/landing'
      url.search = ''
      url.protocol = 'http:' // v162.1 — forwarded https made Next treat the rewrite as cross-origin and proxy it with a broken TLS scheme
      return NextResponse.rewrite(url)
    }
    if (pathname === '/') {
      const url = req.nextUrl.clone()
      url.pathname = '/landing'
      url.search = ''
      url.protocol = 'http:' // v162.1 — forwarded https made Next treat the rewrite as cross-origin and proxy it with a broken TLS scheme
      return NextResponse.rewrite(url)
    }
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.search = pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : ''
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/zip).*)'],
}
