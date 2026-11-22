/**
 * Cloud Agent socket.io service.
 *
 * Provides real-time channels for:
 *   - terminal: a persistent interactive shell per project (xterm.js writes
 *     to `terminal:input`, server streams output back via `terminal:output`)
 *   - logs: project runtime logs (server pushes when subprocess emits)
 *   - agent: agent event stream (replaces the NDJSON HTTP stream when the
 *     client prefers WebSocket)
 *
 * Started as a separate bun process on port 3001. The Caddyfile already
 * routes `?XTransformPort=3001` requests to this port.
 */
import { createServer } from 'http'
import { Server } from 'socket.io'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import path from 'path'
import fs from 'fs'

const PORT = 3001
const PROJECTS_DIR = process.env.PROJECTS_DIR || '/home/z/my-project/projects'

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

interface TerminalSession {
  proc: ChildProcessWithoutNullStreams
  cwd: string
}

const terminals = new Map<string, TerminalSession>()

// v146 WATCHDOG RE-ARM — this process is an immortal boot-tree child (bun
// --hot on :3001), while the dev-watchdog it spawns can be reaped mid-session
// (sandbox reaper sweeps stray setsid processes; incident 06:42: watchdog +
// :3200 both dead while :3000/:3001 stayed up). Every 5 min: if the watchdog
// lock is missing or stale (>150 s), spawn boot-guard.sh from HERE — any
// child of this tree survives. boot-guard is single-instance (lock-owned),
// so re-running is always safe. bun --hot re-runs top-level code on reload;
// the globalThis guard keeps exactly one interval alive.
const rearmWatchdog = () => {
  try {
    const LOCK = '/home/z/my-project/.dev-watchdog.lock'
    let stale = true
    try {
      const age = (Date.now() - fs.statSync(LOCK).mtimeMs) / 1000
      stale = age > 150
    } catch {}
    if (stale) {
      const { spawn } = require('child_process') as typeof import('child_process')
      const g = spawn('bash', ['/home/z/my-project/scripts/boot-guard.sh'], {
        cwd: '/home/z/my-project',
        detached: true,
        stdio: 'ignore',
      })
      g.on('error', () => {})
      g.unref()
    }
  } catch {}
}
const G = globalThis as any
if (!G.__caWdRearm) {
  G.__caWdRearm = true
  rearmWatchdog()
  setInterval(rearmWatchdog, 300_000)
}

function projectRoot(projectId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error('Invalid projectId')
  return path.join(PROJECTS_DIR, projectId)
}

function ensureProjectDir(projectId: string): string {
  const root = projectRoot(projectId)
  fs.mkdirSync(root, { recursive: true })
  return root
}

io.on('connection', (socket) => {
  socket.emit('hello', { ok: true, ts: Date.now() })

  // Terminal: attach to a project's persistent shell
  socket.on('terminal:start', ({ projectId }: { projectId: string }) => {
    if (!projectId) return
    // Stop any existing shell for this socket
    const existing = terminals.get(socket.id)
    if (existing) {
      try { existing.proc.kill('SIGKILL') } catch {}
    }
    const cwd = ensureProjectDir(projectId)
    // Use bash without -i to avoid "cannot set terminal process group" / "no job control" warnings.
    // We set PS1 so the prompt looks like a normal interactive shell.
    const proc = spawn('bash', ['--norc', '--noprofile'], {
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        FORCE_COLOR: '0',
        PS1: 'cloud-agent:\\w$ ',
        // Disable bash startup files that might emit noise
        BASH_ENV: '',
      },
    })
    terminals.set(socket.id, { proc, cwd })

    // Send an initial prompt + clear so the user sees a clean shell
    proc.stdin.write('clear\n')

    proc.stdout.on('data', (d) => {
      socket.emit('terminal:output', d.toString())
    })
    proc.stderr.on('data', (d) => {
      socket.emit('terminal:output', d.toString())
    })
    proc.on('close', (code) => {
      socket.emit('terminal:output', `\r\n[process exited with code ${code}]\r\n`)
      terminals.delete(socket.id)
    })

    socket.emit('terminal:ready', { cwd })
  })

  socket.on('terminal:input', ({ data }: { data: string }) => {
    const t = terminals.get(socket.id)
    if (t) t.proc.stdin.write(data)
  })

  socket.on('terminal:resize', ({ cols, rows }: { cols: number; rows: number }) => {
    // Best-effort resize signal — we'd need node-pty for true TIOCSWINSZ.
    // For now bash handles cols/rows from $COLUMNS/$LINES env if set.
    const t = terminals.get(socket.id)
    if (t) {
      try { (t.proc as any).kill('SIGWINCH') } catch {}
    }
  })

  socket.on('terminal:kill', () => {
    const t = terminals.get(socket.id)
    if (t) {
      try { t.proc.kill('SIGKILL') } catch {}
      terminals.delete(socket.id)
    }
  })

  socket.on('terminal:clear', () => {
    socket.emit('terminal:output', '\x1b[2J\x1b[H')
  })

  // Live log subscription: client subscribes to a project's log channel
  socket.on('logs:subscribe', ({ projectId }: { projectId: string }) => {
    socket.join(`logs:${projectId}`)
  })

  socket.on('disconnect', () => {
    const t = terminals.get(socket.id)
    if (t) {
      try { t.proc.kill('SIGKILL') } catch {}
      terminals.delete(socket.id)
    }
  })
})

httpServer.listen(PORT, () => {
  console.log(`Cloud Agent socket.io service listening on port ${PORT}`)
})

/* ============================================================================
 * v79 — WEB-SERVER SELF-HEAL (runs inside this long-lived bun process, which
 * is parented to the sandbox init tree and survives tool-call cleanups that
 * reap anything we spawn from shell sessions).
 *
 * Observed failure mode: next-server ballooned to 2.1GB RSS on the 4GB-no-swap
 * sandbox and the kernel OOM-killed it → every request 502'd until a manual
 * restart, and processes spawned to fix it got reaped between tool calls.
 *
 * This supervisor (child of the init tree) probes :3000 every 20s; after two
 * consecutive failures it kills orphaned project-run processes, cold-clears
 * .next (chunk consistency — the old TerminalPane ChunkLoadError), and
 * respawns next dev with a hard JS-heap cap (NODE_OPTIONS max-old-space-size)
 * so the host OOM death cannot recur. State changes are logged to
 * dev-watchdog.log. All spawn errors are swallowed — this must never take the
 * socket service down with it.
 * ========================================================================= */
const WEB_SUPERVISOR = (() => {
  try {
    const BASE = '/home/z/my-project'
    const HEAL_LOG = `${BASE}/dev-watchdog.log`
    const HEAP_CAP = '1280' // MB
    let fails = 0
    let healing = false

    const log = (msg: string) => {
      try { fs.appendFileSync(HEAL_LOG, `[${new Date().toISOString()}] [web-heal] ${msg}\n`) } catch {}
    }

    const probe = async (): Promise<boolean> => {
      try {
        const ctl = new AbortController()
        const t = setTimeout(() => ctl.abort(), 15_000)
        const res = await fetch('http://localhost:3000/api/lock', { signal: ctl.signal })
        clearTimeout(t)
        return res.status < 550
      } catch { return false }
    }

    const killOrphans = () => {
      try {
        const procIds = fs.readdirSync('/proc').filter(p => /^\d+$/.test(p))
        for (const pid of procIds) {
          try {
            // v86 FIX (owner: "Run problem"): only TRUE orphans (ppid == 1)
            // older than 3 minutes — the old sweep killed LIVE user apps and
            // mid-flight npm installs on every platform bad window.
            const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
            // fields after "(comm)": state ppid pgrp … starttime — comm may
            // contain spaces/parens, so split on the LAST ") " instead.
            const afterComm = stat.slice(stat.lastIndexOf(') ') + 2).trim().split(' ')
            const ppid = Number(afterComm[1] ?? 0)
            if (ppid !== 1) continue
            const uptime = Number(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0])
            const startTicks = Number(afterComm[19] ?? 0)
            const age = uptime - startTicks / 100
            if (age < 180) continue
            const cwd = fs.readlinkSync(`/proc/${pid}/cwd`)
            if (cwd.startsWith(`${BASE}/projects/`)) {
              process.kill(Number(pid), 'SIGKILL')
              log(`killed orphan ${pid} (age=${Math.round(age)}s, cwd=${cwd})`)
            }
          } catch {}
        }
      } catch {}
    }

    const heal = () => {
      if (healing) return
      healing = true
      log(':3000 DOWN — recovering (orphan cleanup + restart, heap cap ' + HEAP_CAP + 'MB)')
      killOrphans()
      try {
        const { execSync, spawn } = require('child_process') as typeof import('child_process')
        // v86: scope the kill to the PLATFORM's own next processes (cwd ==
        // $BASE) — a blanket `pkill -f "next dev"` also killed generated apps
        // running `next dev -p 4xxx` inside projects/.
        try { execSync(`for p in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do c=$(readlink /proc/$p/cwd 2>/dev/null) || continue; [ "$c" = "${BASE}" ] || continue; tr '\\0' ' ' < /proc/$p/cmdline 2>/dev/null | grep -qE 'next dev|next-server' && kill -9 $p 2>/dev/null; done; true`, { shell: '/bin/bash' }) } catch {}
        // v102 PROD-AWARE: this healer used to rm -rf .next and respawn
        // `next dev` UNCONDITIONALLY — it silently destroyed the v101
        // production build (420MB RSS) and dragged the platform back into
        // RAM-ballooning dev mode. Now it honors .prodmode exactly like
        // scripts/dev-watchdog.sh: prod marker + BUILD_ID → `next start`
        // (the build is NEVER wiped); dev fallback keeps the cold-clear.
        const { existsSync } = require('fs') as typeof import('fs')
        const prodMode = existsSync(`${BASE}/.prodmode`) && existsSync(`${BASE}/.next/BUILD_ID`)
        if (prodMode) {
          const out = fs.openSync(`${BASE}/dev.log`, 'a')
          const child = spawn('bash', ['-c', `cd ${BASE} && PATH=${BASE}/node_modules/.bin:$PATH exec next start -p 3000 2>&1 | tee -a ${BASE}/dev.log`], {
            cwd: BASE,
            detached: true,
            stdio: ['ignore', out, out],
            env: { ...process.env, NODE_OPTIONS: `--max-old-space-size=${HEAP_CAP}`, HOME: '/home/z' },
          })
          child.on('error', (e: Error) => log('spawn error: ' + e.message))
          child.unref()
          log('next start respawned (PRODUCTION build preserved, heap-capped)')
        } else {
          try { fs.rmSync(`${BASE}/.next`, { recursive: true, force: true }) } catch {}
          const out = fs.openSync(`${BASE}/dev.log`, 'a')
          const child = spawn('bash', ['-c', `cd ${BASE} && PATH=${BASE}/node_modules/.bin:$PATH exec next dev -p 3000 2>&1 | tee -a ${BASE}/dev.log`], {
            cwd: BASE,
            detached: true,
            stdio: ['ignore', out, out],
            env: { ...process.env, NODE_OPTIONS: `--max-old-space-size=${HEAP_CAP}`, HOME: '/home/z' },
          })
          child.on('error', (e: Error) => log('spawn error: ' + e.message))
          child.unref()
          log('next dev respawned (detached, heap-capped)')
        }
      } catch (e: any) {
        log('heal failed: ' + (e?.message || e))
      } finally {
        // long cooldown — boot + first compile before probing again
        setTimeout(() => { healing = false; fails = 0 }, 75_000)
      }
    }

    // v79.1: bun --hot does NOT keep setInterval timers alive across module
    // generations (observed: exactly one tick then silence). Instead of
    // in-process timers, hand the loop to the bash watchdog — spawned as a
    // CHILD of this init-tree bun process, so it survives like bun does. The
    // script is single-instance (own lock), so hot-reload re-runs are safe.
    try {
      const { spawn } = require('child_process') as typeof import('child_process')
      const out = fs.openSync(`${BASE}/dev-watchdog.log`, 'a')
      const wd = spawn('bash', [`${BASE}/scripts/dev-watchdog.sh`], {
        cwd: BASE, detached: true, stdio: ['ignore', out, out],
        env: { ...process.env, HOME: '/home/z' },
      })
      wd.on('error', (e: Error) => log('watchdog spawn error: ' + e.message))
      wd.unref()
      log('watchdog spawned (pid ' + wd.pid + ')')
    } catch (e: any) {
      log('watchdog spawn failed: ' + (e?.message || e))
    }
    return true
  } catch { return false }
})()
// v79.2 re-arm

// v140 vortex guard touch: 1794576287

// v140.1 reload 1794576771
