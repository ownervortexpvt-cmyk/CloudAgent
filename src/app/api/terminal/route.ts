import { NextRequest, NextResponse } from 'next/server'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import path from 'path'
import fs from 'fs'
import { randomBytes } from 'crypto'
import { sdkPaths, sdkEnv } from '@/lib/runtime'
import { requireProjectAccess } from '@/lib/auth'

/**
 * In-memory terminal sessions — each project gets one persistent shell.
 * The client polls /api/terminal?projectId=X&sessionId=Y for output, and
 * POSTs input via /api/terminal with { sessionId, data }.
 *
 * This avoids the socket.io dependency and works through any HTTP proxy
 * (Caddy, nginx, Cloudflare, etc.) without WebSocket upgrade issues.
 */

interface TermSession {
  proc: ChildProcessWithoutNullStreams
  cwd: string
  /** v138 SECURITY FIX — owning project; every input/GET/kill call is now
   *  checked against it so a leaked sessionId alone grants nothing. */
  projectId: string
  buffer: string  // accumulated output not yet polled
  cols: number
  rows: number
  shell: string   // v63: which shell this session actually runs
  createdAt: number
  lastActivity: number
}

const sessions = new Map<string, TermSession>()

// Clean up sessions older than 1 hour of inactivity
setInterval(() => {
  const now = Date.now()
  for (const [id, s] of sessions.entries()) {
    if (now - s.lastActivity > 60 * 60 * 1000) {
      try { s.proc.kill('SIGKILL') } catch {}
      sessions.delete(id)
    }
  }
}, 60_000).unref()

function projectRoot(projectId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error('Invalid projectId')
  return path.join(process.env.PROJECTS_DIR || '/home/z/my-project/projects', projectId)
}

function ensureProjectDir(projectId: string): string {
  const root = projectRoot(projectId)
  fs.mkdirSync(root, { recursive: true })
  return root
}

const SHELL_SEARCH_PATHS = ['/bin', '/usr/bin', '/usr/local/bin', '/sbin']

/** v63: Settings → Terminal shell choice finally reaches this route.
 *  Whitelisted, existence-checked, honest fallback — a shell the box
 *  doesn't have must NOT silently run something else without saying so. */
function resolveShell(requested?: string): { shell: string; fallbackFrom?: string } {
  const want = typeof requested === 'string' ? requested.trim() : ''
  if (!want || want === 'bash' || !/^[a-z][a-z0-9_-]*$/i.test(want)) return { shell: 'bash' }
  for (const dir of SHELL_SEARCH_PATHS) {
    try { if (fs.existsSync(path.join(dir, want))) return { shell: want } } catch {}
  }
  return { shell: 'bash', fallbackFrom: want }
}

function createSession(projectId: string, shell = 'bash'): TermSession {
  const cwd = ensureProjectDir(projectId)
  // v86 FIX (owner: "add kora storage e store kore raksena abong shorashori
  // use korte parsena"): the Terminal used to spawn WITHOUT the operator
  // SDK paths — flutter/javac/gradle/dotnet were invisible there even though
  // project runs had them. The Terminal now injects the exact same sdkPaths
  // + sdkEnv the runner uses, so every installed toolchain works directly.
  const sdkBin = [...sdkPaths()]
  const envVars: Record<string, string> = { ...sdkEnv() }
  const proc = spawn(shell, shell === 'bash' ? ['--norc', '--noprofile'] : [], {
    cwd,
    env: {
      ...process.env,
      ...envVars,
      TERM: 'xterm-256color',
      FORCE_COLOR: '0',
      PS1: 'cloud-agent:\\w$ ',
      BASH_ENV: '',
      // Add common bin paths + every installed SDK bin dir
      PATH: `/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/home/z/.bun/bin:/home/z/.local/bin:${sdkBin.join(':')}:${process.env.PATH || ''}`,
    },
  })
  const session: TermSession = {
    proc,
    cwd,
    projectId,
    buffer: '',
    cols: 80,
    rows: 24,
    shell,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  }

  proc.stdout.on('data', (d) => {
    session.buffer += d.toString()
    // Cap buffer to 1MB to avoid memory issues
    if (session.buffer.length > 1_000_000) {
      session.buffer = session.buffer.slice(-500_000)
    }
    session.lastActivity = Date.now()
  })
  proc.stderr.on('data', (d) => {
    session.buffer += d.toString()
    if (session.buffer.length > 1_000_000) {
      session.buffer = session.buffer.slice(-500_000)
    }
    session.lastActivity = Date.now()
  })
  proc.on('close', (code) => {
    session.buffer += `\r\n[process exited with code ${code}]\r\n`
    session.lastActivity = Date.now()
  })

  // Send initial clear + prompt
  proc.stdin.write('clear\n')
  return session
}

/**
 * POST /api/terminal
 * Body: { action: 'start' | 'input' | 'resize' | 'kill', projectId?, sessionId?, data?, cols?, rows? }
 *
 * Returns: { sessionId, ready, cwd } or { ok } or { error }
 */

/** v138 SECURITY FIX — access guard for every non-start action: the session
 *  holder must still have access to the session's project (owner/admin/
 *  collaborator). Previously knowing a sessionId was enough to drive or
 *  read ANOTHER tenant's shell — a full cross-tenant RCE hole.
 *  Callers MUST handle the 404 themselves (keeps TS narrowing). */
async function assertSessionAccess(req: NextRequest, s: TermSession): Promise<NextResponse | null> {
  try {
    await requireProjectAccess(req, s.projectId)
  } catch (e: any) {
    if (e instanceof Response) return e as any
    throw e
  }
  return null
}
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action, projectId, sessionId, data, cols, rows } = body || {}

  if (action === 'start') {
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  // BUSINESS v2: verify the caller owns this project (admins exempt).
  if (projectId) {
    try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  }
    const { shell, fallbackFrom } = resolveShell(body.shell)
    // Find an existing session for this project, or create new. v63: when
    // the requested shell differs from the running one, the old session is
    // killed and a fresh one started — "takes effect on the next terminal
    // session" is now TRUE via the ↻ Restart button.
    let existingId: string | null = null
    for (const [id, s] of sessions.entries()) {
      if (s.cwd === projectRoot(projectId) && s.proc.exitCode === null) {
        if (s.shell !== shell) {
          try { s.proc.kill('SIGKILL') } catch {}
          sessions.delete(id)
        } else {
          existingId = id
        }
        break
      }
    }
    const fallbackNote = fallbackFrom ? { note: `"${fallbackFrom}" is not installed on this server — running bash instead` } : {}
    if (existingId) {
      return NextResponse.json({ sessionId: existingId, ready: true, cwd: sessions.get(existingId)!.cwd, shell, ...fallbackNote })
    }
    const newId = randomBytes(16).toString('hex')
    try {
      const session = createSession(projectId, shell)
      sessions.set(newId, session)
      return NextResponse.json({ sessionId: newId, ready: true, cwd: session.cwd, shell, ...fallbackNote })
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 })
    }
  }

  if (action === 'input') {
    if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    const s = sessions.get(sessionId)
    if (!s) return NextResponse.json({ error: 'session not found' }, { status: 404 })
    const denied = await assertSessionAccess(req, s)
    if (denied) return denied
    if (s.proc.exitCode !== null) return NextResponse.json({ error: 'session ended' }, { status: 410 })
    try {
      // v112 FIX (owner: "app bananor shomoy flutter error ase 127"): the UI
      // (xterm.js) sends Enter as '\r', but the session shell is a NON-PTY
      // bash — '\r' is NOT a line terminator there. Typed commands hung
      // forever, and whatever was typed later glue-terminated into a garbage
      // command name ("flutter\rx") → "command not found" → exit 127.
      // Normalize CRLF/CR → LF at the API boundary so the shell finally
      // behaves like the real terminal the UI shows.
      const normalized = String(data || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      s.proc.stdin.write(normalized)
      s.lastActivity = Date.now()
      return NextResponse.json({ ok: true })
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 })
    }
  }

  if (action === 'resize') {
    if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    const s = sessions.get(sessionId)
    if (!s) return NextResponse.json({ error: 'session not found' }, { status: 404 })
    const denied = await assertSessionAccess(req, s)
    if (denied) return denied
    if (cols) s.cols = cols
    if (rows) s.rows = rows
    try { s.proc.kill('SIGWINCH') } catch {}
    return NextResponse.json({ ok: true })
  }

  if (action === 'kill') {
    if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    const s = sessions.get(sessionId)
    const denied = s ? await assertSessionAccess(req, s) : null
    if (denied) return denied
    if (s) {
      try { s.proc.kill('SIGKILL') } catch {}
      sessions.delete(sessionId)
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'clear') {
    if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    const s = sessions.get(sessionId)
    const denied = s ? await assertSessionAccess(req, s) : null
    if (denied) return denied
    if (s) {
      s.buffer = '\x1b[2J\x1b[H'
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}

/**
 * GET /api/terminal?sessionId=Y
 *
 * Returns accumulated output since last poll. The client polls this every
 * 100-200ms to get incremental output.
 *
 * Returns: { output, ended }
 */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId')
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  const s = sessions.get(sessionId)
  if (!s) return NextResponse.json({ error: 'session not found' }, { status: 404 })
  const denied = await assertSessionAccess(req, s)
  if (denied) return denied
  const output = s.buffer
  s.buffer = ''  // Clear after read
  const ended = s.proc.exitCode !== null
  return NextResponse.json({ output, ended, cwd: s.cwd })
}
