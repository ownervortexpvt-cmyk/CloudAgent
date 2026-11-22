import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import {
  ECOSYSTEM_REPO_DIR,
  ECOSYSTEM_REPO_NAME,
  ecoTokenFromRequest,
  verifyEcoToken,
} from '@/lib/ecosystem-git'

/**
 * ECOSYSTEM CODE HUB (v152) — Git Smart HTTP transport, self-hosted.
 *
 * This route IS the ecosystem's git remote. No GitHub, no Cloudflare, no
 * third party: clones/pushes hit this platform's own URL:
 *
 *   git clone https://<host>/api/ecosystem-git/vortex-ecosystem.git
 *   (username: anything — e.g. "vortex"; password: an admin-panel token)
 *
 * Protocol: git clients speak smart-http — GET  <repo>/info/refs?service=…
 * advertisement, then POST <repo>/git-upload-pack (fetch) or
 * <repo>/git-receive-pack (push). We exec `git http-backend` (ships with
 * git) as a CGI child and relay the exchange. The body is buffered (source
 * pushes are small) which keeps us fully compatible with the preview
 * gateway; responses are streamed back.
 *
 * Auth: the middleware list leaves this path alone; THIS route demands a
 * valid ecosystem token (Basic password, x-ecosystem-token header, or
 * ?token=) on EVERY request, then sets REMOTE_USER so http-backend enables
 * receive-pack. Invalid/absent token → 401 before any git code runs.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BODY = 200 * 1024 * 1024 // 200 MB — generous for source pushes

function unauthorized(msg: string) {
  return NextResponse.json(
    { ok: false, error: msg },
    { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Vortex Ecosystem Git"' } },
  )
}

async function handle(req: NextRequest, method: 'GET' | 'POST') {
  const { pathname, searchParams } = req.nextUrl
  // strip the mount point → PATH_INFO for the CGI ("vortex-ecosystem.git/info/refs")
  const rel = pathname.replace(/^\/api\/ecosystem-git\/?/, '')
  if (!rel || !rel.startsWith(ECOSYSTEM_REPO_NAME)) {
    return NextResponse.json(
      { ok: false, error: `unknown repo path — use /api/ecosystem-git/${ECOSYSTEM_REPO_NAME}` },
      { status: 404 },
    )
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined
  const plain = ecoTokenFromRequest(
    req.headers.get('authorization'),
    req.headers.get('x-ecosystem-token'),
    searchParams.get('token'),
  )
  const token = await verifyEcoToken(plain, ip)
  if (!token) return unauthorized('valid ecosystem token required (password = token, any username)')
  const actor = token.name || 'editor'

  // git protocol v2 negotiation header
  const gitProto = req.headers.get('git-protocol') || undefined
  const contentEncoding = req.headers.get('content-encoding') || undefined
  const contentType = req.headers.get('content-type') || undefined

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    GIT_PROJECT_ROOT: ECOSYSTEM_REPO_DIR,
    GIT_HTTP_EXPORT_ALL: '1',
    PATH_INFO: `/${rel}`,
    REQUEST_METHOD: method,
    QUERY_STRING: searchParams.toString(),
    REMOTE_USER: actor,
    REMOTE_ADDR: ip || '127.0.0.1',
    GIT_COMMITTER_NAME: actor,
    GIT_COMMITTER_EMAIL: `${actor}@ecosystem.local`,
  }
  if (gitProto) env.HTTP_GIT_PROTOCOL = gitProto
  if (contentEncoding) env.HTTP_CONTENT_ENCODING = contentEncoding
  if (contentType) env.CONTENT_TYPE = contentType

  const body = method === 'POST' ? Buffer.from(await req.arrayBuffer()) : null
  if (body && body.byteLength > MAX_BODY) {
    return NextResponse.json({ ok: false, error: 'push too large' }, { status: 413 })
  }
  if (body) env.CONTENT_LENGTH = String(body.byteLength)

  return new Promise<NextResponse | Response>((resolve) => {
    const proc = spawn('git', ['http-backend'], { env, cwd: ECOSYSTEM_REPO_DIR })
    const chunks: Buffer[] = []
    let headerDone = false
    let headerText = ''
    let status = 200
    let outType = 'application/octet-stream'
    let settled = false

    const finish = () => {
      if (settled) return
      settled = true
      const payload = Buffer.concat(chunks)
      resolve(
        new Response(new Uint8Array(payload), {
          status,
          headers: { 'Content-Type': outType, 'Cache-Control': 'no-cache' },
        }),
      )
    }

    proc.stdout.on('data', (d: Buffer) => {
      if (headerDone) { chunks.push(d); return }
      headerText += d.toString('latin1')
      const idx = headerText.indexOf('\r\n\r\n')
      if (idx === -1) return
      const head = headerText.slice(0, idx)
      const rest = headerText.slice(idx + 4)
      for (const line of head.split('\r\n')) {
        const m = line.match(/^Status:\s*(\d+)/i)
        if (m) status = Number(m[1])
        const t = line.match(/^Content-Type:\s*(.+)$/i)
        if (t) outType = t[1].trim()
      }
      headerDone = true
      if (rest.length) chunks.push(Buffer.from(rest, 'latin1'))
    })
    proc.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      // http-backend writes progress/diagnostics to stderr; keep the useful
      // ones visible in the dev log for deploy debugging.
      if (!/remote:/.test(s)) console.log(`[ecosystem-git] ${s.trim().slice(0, 300)}`)
    })
    proc.on('error', (e) => {
      console.error('[ecosystem-git] spawn failed:', e.message)
      if (!settled) {
        settled = true
        resolve(NextResponse.json({ ok: false, error: 'git http-backend unavailable' }, { status: 500 }))
      }
    })
    proc.on('close', () => finish())

    if (body) {
      proc.stdin.on('error', () => { /* client aborted */ })
      proc.stdin.end(body)
    } else {
      proc.stdin.end()
    }
  })
}

export async function GET(req: NextRequest) {
  return handle(req, 'GET')
}

export async function POST(req: NextRequest) {
  return handle(req, 'POST')
}
