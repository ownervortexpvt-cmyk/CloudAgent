/**
 * v93 — PREVIEW PROXY: same-origin bridge to the app running on localhost:<port>.
 *
 * WHY THIS EXISTS (owner: "admin app section e ei cloud agent kei dekhacche ❌"):
 * the LivePreview iframe used `?XTransformPort=<port>` — a Caddy-:81 convention.
 * But the phone can only reach the BUILDER origin (:3000 through the z.ai
 * edge), and Next.js ignores XTransformPort — so every preview iframe rendered
 * the BUILDER itself ("cloud agent") instead of the generated app. The v76-v86
 * admin-probe work was verified against :81 directly, never against the real
 * iframe origin, so the break was invisible to every E2E.
 *
 * This route proxies EVERY method to 127.0.0.1:<port> over the same origin:
 *   /preview/4001/                → app "/"          (user app)
 *   /preview/4001/admin.html      → app "/admin.html" (admin app)
 * HTML/CSS responses get rewritten so the app's ABSOLUTE-PATH refs survive the
 * prefix ("/style.css" → "/preview/4001/style.css"), and a <base> tag fixes
 * relative refs. Streaming passthrough for everything else (images, chunks).
 *
 * HONEST LIMITS (documented, not hidden):
 *  - WebSocket/HMR (vite/next dev hot reload) cannot upgrade through a route
 *    handler — the app still renders; hot-reload logs may complain.
 *  - SPA client routers see the /preview/<port>/ prefix — static admin pages
 *    (admin.html, the agent FULL-PRODUCT default) are perfect; client-route
 *    admin views may not route. Apps that need it should ship admin.html.
 *  - Set-Cookie from the app is DROPPED — a preview app must never be able to
 *    write cookies into the builder's origin (lock-session safety).
 */
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PORT_RE = /^[0-9]{4,5}$/

function proxyUrl(req: NextRequest, port: string, sub: string): string {
  const incoming = new URL(req.url).searchParams
  const qs = incoming.toString()
  return `http://127.0.0.1:${port}/${sub}${qs ? `?${qs}` : ''}`
}

/** Rewrites that make an app mounted under /preview/<port>/ work. */
function rewriteBody(body: string, port: string, contentType: string): string {
  const p = `/preview/${port}/`
  if (/text\/html/i.test(contentType)) {
    let out = body
    // root-relative attribute refs → prefixed
    out = out.replace(
      /(\s(?:href|src|action|poster|formaction|data)\s*=\s*(["']))\/(?!\/)/gi,
      (_m, pre) => `${pre}${p}`,
    )
    // url(/x) in inline styles / <style> blocks
    out = out.replace(/url\((\s*(['"]?))\/(?!\/)/gi, (_m, pre) => `url(${pre}${p}`)
    // srcset="/a 1x, /b 2x"
    out = out.replace(/(\ssrcset\s*=\s*(["']))\//gi, (_m, pre) => `${pre}${p}`)
    // <base> AFTER <head…> so relative refs resolve under the prefix even when
    // the attribute regex above misses a form
    if (!/<base\s/i.test(out)) {
      if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, m => `${m}<base href="${p}">`)
      else out = `<base href="${p}">` + out
    }
    return out
  }
  if (/text\/css/i.test(contentType)) {
    return body.replace(/url\((\s*(['"]?))\/(?!\/)/gi, (_m, pre) => `url(${pre}${p}`)
  }
  return body
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ port: string; path?: string[] }> }) {
  const { port, path } = await ctx.params
  if (!PORT_RE.test(port) || port === '3000' || port === '3001') {
    return new Response('bad preview port', { status: 400 })
  }
  const sub = (path || []).join('/')
  const method = req.method.toUpperCase()
  const hasBody = method !== 'GET' && method !== 'HEAD'
  let body: ArrayBuffer | undefined
  if (hasBody) body = await req.arrayBuffer()

  const fwdHeaders: Record<string, string> = {}
  const ct = req.headers.get('content-type')
  if (ct) fwdHeaders['content-type'] = ct
  const range = req.headers.get('range')
  if (range) fwdHeaders['range'] = range
  const accept = req.headers.get('accept')
  if (accept) fwdHeaders['accept'] = accept

  let upstream: Response
  try {
    upstream = await fetch(proxyUrl(req, port, sub), {
      method,
      headers: fwdHeaders,
      body: hasBody ? body : undefined,
      redirect: 'follow', // app redirects resolve inside the proxy — no Location rewriting needed
      signal: AbortSignal.timeout(60_000), // dev servers compile lazily on first hit
      // @ts-expect-error undici-specific, harmless elsewhere
      duplex: hasBody ? 'half' : undefined,
    })
  } catch {
    return new Response(
      `<!doctype html><title>Preview</title><body style="font-family:system-ui;padding:2rem">App is not answering on port ${port} — it may still be starting. Reload in a moment.</body>`,
      { status: 502, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
    )
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream'
  const rewriteable = /text\/html|text\/css/i.test(contentType)

  if (!rewriteable && upstream.body) {
    // STREAM passthrough (binary assets, chunks, video ranges) — drop hop/
    // security headers that would corrupt or block the same-origin embed
    const h = new Headers()
    for (const [k, v] of upstream.headers) {
      if (/set-cookie|content-encoding|content-length|transfer-encoding|content-security-policy|x-frame-options/i.test(k)) continue
      h.set(k, v)
    }
    h.set('cache-control', 'no-store')
    return new Response(upstream.body, { status: upstream.status, headers: h })
  }

  // small cap: rewritten bodies are buffered (agent apps are small; streams
  // that big are already covered by the passthrough branch)
  const raw = await upstream.text().catch(() => '')
  const out = rewriteBody(raw, port, contentType)
  const h = new Headers({ 'content-type': contentType, 'cache-control': 'no-store' })
  return new Response(out, { status: upstream.status, headers: h })
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
export const HEAD = proxy
export const OPTIONS = proxy
