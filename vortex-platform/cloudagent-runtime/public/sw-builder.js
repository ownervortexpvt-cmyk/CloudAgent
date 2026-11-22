/**
 * Builder PWA service worker — v67 (re-delivery of the lost v66 stale-shell
 * guard, hardened).
 *
 * WHY THIS EXISTS: the builder sits behind a preview gateway that sometimes
 * answers 502/504 (server compiling / restarting). The OLD service worker
 * fell back to ANY cached shell on network failure — so after a 502 the
 * phone kept showing a WEEKS-old app (the "63 providers / no new features"
 * ghost) and every reload looked broken or extremely slow. This version:
 *
 *  1. NEVER touches /api/* or non-GET requests (agent streams, uploads…)
 *  2. cache-first ONLY for /_next/static (immutable hashed assets)
 *  3. shells ('/', '/lock') are network-first with:
 *       - a 10s timeout guard (shells are small; a hung gateway must not
 *         spin forever — APIs are NOT intercepted so long agent runs are
 *         never aborted by this worker)
 *       - redirect:'manual' so an auth bounce is passed through and NEVER
 *         cached as a shell
 *       - only ok + non-redirected responses get cached
 *  4. stale-shell honesty: if the network fails and the cached shell is
 *     older than 30 minutes, show an honest interstitial (with the shell's
 *     real age) + a cache-busting Retry — never silently resurrect an old
 *     app
 *  5. activate deletes EVERY cache that isn't the current one, so upgrading
 *     phones drop their stale shells on the next load
 */
const CACHE = 'ca-builder-v22' // v124: ultra speed pass + hot indexes + orphan sweep
const SHELLS = ['/', '/lock', '/manifest.webmanifest', '/icon.svg']
const STALE_MS = 30 * 60 * 1000 // 30 min — older cached shells are "stale"
const NET_TIMEOUT_MS = 10_000 // shells only — APIs bypass this worker

/** Freshness marker written alongside every cached shell. */
async function markShellFresh() {
  try {
    const c = await caches.open(CACHE)
    await c.put('/__ca_shell_ts', new Response(String(Date.now())))
  } catch {}
}

async function shellAgeMs() {
  try {
    const c = await caches.open(CACHE)
    const m = await c.match('/__ca_shell_ts')
    if (!m) return Infinity
    const t = Number(await m.text())
    return Number.isFinite(t) ? Date.now() - t : Infinity
  } catch {
    return Infinity
  }
}

function honestInterstitial(ageMinutes, retryTo) {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vortex Cloud Agent — reconnecting</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0e14;color:#e5e7eb;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.box{max-width:420px;padding:32px;text-align:center;line-height:1.5}
h1{font-size:18px;margin:0 0 12px}p{font-size:14px;color:#9ca3af;margin:0 0 20px}
button{background:#f59e0b;color:#111;border:0;border-radius:10px;padding:12px 22px;font-size:15px;font-weight:600}
.small{font-size:12px;color:#6b7280;margin-top:16px}</style></head>
<body><div class="box"><h1>⚠️ The saved copy of this app is stale</h1>
<p>The network is unreachable right now, and the copy saved on this phone is <b>${ageMinutes} min</b> old — it may be missing newer features, so it was not opened automatically.</p>
<button onclick="location.replace(${JSON.stringify(retryTo)})">Retry now</button>
<p class="small">Auto-retrying every 15s… (attempt <span id="n">1</span>). If this keeps failing, the builder server is probably restarting — wait a moment.</p>
<script>var n=1;setInterval(function(){n++;var e=document.getElementById('n');if(e)e.textContent=n;location.replace(${JSON.stringify(retryTo)})},15000);</script>
</div></body></html>`
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELLS).catch(() => {}))
      .then(() => markShellFresh())
      .then(() => self.skipWaiting())
  )
})

// v117.2 — update notification flow: the page can ask a waiting worker to
// take over immediately (belt-and-braces; install already skipWaiting()s).
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'CA_SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then((deleted) => self.clients.claim().then(() => {
        // v117.2 — tell every open tab this activation REPLACED an older
        // version (a real upgrade, not the first install). The page shows
        // the "New version available — tap to update" banner on this signal.
        if (deleted && deleted.length > 0) {
          self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
            for (const cl of cls) cl.postMessage({ type: 'CA_NEW_VERSION', version: CACHE })
          })
        }
      }))
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/')) return // APIs NEVER pass through — long agent streams are untouchable

  // immutable build assets — cache first (only cache clean, non-redirected 200s)
  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(req)
        if (hit) return hit
        let res
        try {
          res = await fetch(req)
        } catch {
          return new Response('', { status: 504, statusText: 'offline' })
        }
        if (res && res.ok && !res.redirected) c.put(req, res.clone())
        return res
      })
    )
    return
  }

  // shells — network first, guarded fallback (offline opening stays possible)
  if (url.pathname === '/' || url.pathname === '/lock') {
    e.respondWith(
      (async () => {
        let res = null
        try {
          res = await fetch(req, { redirect: 'manual', signal: AbortSignal.timeout(NET_TIMEOUT_MS) })
        } catch {
          res = null
        }
        // auth bounce (manual redirect) — pass through, NEVER cache as shell
        if (res && (res.status === 301 || res.status === 302 || res.status === 307 || res.status === 308 || res.type === 'opaqueredirect')) {
          const loc = res.headers.get('location')
          if (loc) return Response.redirect(new URL(loc, url).href, 302)
          return Response.redirect(new URL('/lock', url).href, 302)
        }
        if (res && res.ok && !res.redirected) {
          caches.open(CACHE).then(c => c.put(req, res.clone())).catch(() => {})
          markShellFresh()
          return res
        }
        // network failed / gateway error — decide HONESTLY what to serve
        const age = await shellAgeMs()
        const hit = await caches.match(req).then(m => m || null)
        if (!hit) {
          // nothing cached at all → plain offline note (not a fake app)
          return honestInterstitial(0, url.pathname + '?retry=' + Date.now())
        }
        if (age > STALE_MS) {
          // cached shell exists but is OLD — serve the interstitial so the
          // owner is never tricked by a weeks-old app again
          return honestInterstitial(Math.max(1, Math.round(age / 60000)), url.pathname + '?retry=' + Date.now())
        }
        return hit // fresh enough — real offline fallback
      })()
    )
    return
  }

  // everything else (manifest, icons…): network, cache as helper
  if (SHELLS.includes(url.pathname)) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok && !res.redirected) caches.open(CACHE).then(c => c.put(req, res.clone())).catch(() => {})
        return res
      }).catch(() => caches.match(req).then(m => m || Response.error()))
    )
  }
})
