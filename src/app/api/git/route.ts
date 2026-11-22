import { NextRequest, NextResponse } from 'next/server'
import { runtimeManager } from '@/lib/runtime'
import { requireProjectAccess } from '@/lib/auth'

/**
 * Project-local Git (v74) — the "Git status" step of the build pipeline.
 * The GitHub panel covers account-level repos; THIS gives every project a
 * real local repo with honest status/commit/history so the owner can see
 * what the agents changed without a terminal.
 *
 * Auto-provision: on first status call a repo is `git init`-ed, identity is
 * configured locally (never touches global gitconfig) and an initial commit
 * is made, so diffs always start from a real baseline.
 */

interface PorcelainEntry {
  x: string // index status
  y: string // worktree status
  path: string
  origPath?: string // for renames "old -> new"
}

const GIT_IDENTITY = [
  'git config user.name "Cloud Agent"',
  'git config user.email "agent@cloud-agent.local"',
].join(' && ')

async function ensureRepo(projectId: string): Promise<{ ready: boolean; initialized: boolean }> {
  const probe = await runtimeManager.execInProject(projectId, 'git rev-parse --is-inside-work-tree 2>/dev/null', 15000)
  if (probe.code === 0 && probe.stdout.trim() === 'true') return { ready: true, initialized: false }

  // init + local identity + baseline commit
  await runtimeManager.execInProject(
    projectId,
    [
      'git init -b main 2>&1 || git init 2>&1',
      GIT_IDENTITY,
      'git add -A 2>&1',
      'git commit -m "Initial commit (Cloud Agent)" --allow-empty 2>&1',
    ].join(' && '),
    120000,
  )
  // A repo whose baseline commit is empty still counts as ready.
  const verify = await runtimeManager.execInProject(projectId, 'git rev-parse --is-inside-work-tree 2>/dev/null', 15000)
  const ready = verify.code === 0 && verify.stdout.trim() === 'true'
  return { ready, initialized: ready }
}

function parsePorcelain(out: string): { branch: string; entries: PorcelainEntry[] } {
  let branch = 'main'
  const entries: PorcelainEntry[] = []
  for (const line of out.split('\n')) {
    const l = line.trimEnd()
    if (!l) continue
    if (l.startsWith('## ')) {
      branch = l.slice(3).split('...')[0].split(' ')[0].replace(/^\(no branch\)$/, 'detached') || 'main'
      continue
    }
    if (l.length < 4) continue
    const x = l[0]
    const y = l[1]
    let rest = l.slice(3)
    let origPath: string | undefined
    if (rest.includes(' -> ')) {
      const parts = rest.split(' -> ')
      origPath = parts[0]
      rest = parts[1]
    }
    entries.push({ x, y, path: rest, origPath })
  }
  return { branch, entries }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { projectId, action, message } = body || {}
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  // BUSINESS v2: verify the caller owns this project (admins exempt).
  if (projectId) {
    try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  }

  if (action === 'status') {
    const repo = await ensureRepo(projectId)
    if (!repo.ready) {
      return NextResponse.json({ ok: false, error: 'git init failed inside the project directory' }, { status: 500 })
    }
    const st = await runtimeManager.execInProject(
      projectId,
      'git -c core.quotepath=false status --porcelain=v1 -b 2>&1',
      30000,
    )
    const log = await runtimeManager.execInProject(
      projectId,
      'git log --oneline -15 2>&1',
      15000,
    )
    const { branch, entries } = parsePorcelain(st.stdout || '')
    const counts = {
      added: entries.filter(e => e.x === 'A' || e.y === 'A' || e.x === '?').length,
      modified: entries.filter(e => e.x === 'M' || e.y === 'M').length,
      deleted: entries.filter(e => e.x === 'D' || e.y === 'D').length,
      total: entries.length,
    }
    return NextResponse.json({
      ok: true,
      initialized: repo.initialized,
      branch,
      clean: entries.length === 0,
      counts,
      entries,
      recent: (log.stdout || '').split('\n').filter(Boolean).slice(0, 15),
    })
  }

  if (action === 'commit') {
    const repo = await ensureRepo(projectId)
    if (!repo.ready) return NextResponse.json({ ok: false, error: 'git not ready' }, { status: 500 })
    const msg = String(message || '').trim() || 'Update from Cloud Agent'
    // quote-safe: pass message through a single-quoted arg
    const safe = msg.replace(/'/g, `'\\''`)
    const r = await runtimeManager.execInProject(
      projectId,
      `${GIT_IDENTITY} && git add -A && (git commit -m '${safe}' 2>&1 || echo "NOTHING_TO_COMMIT") && git rev-parse --short HEAD 2>&1`,
      60000,
    )
    const nothingToCommit = r.stdout.includes('NOTHING_TO_COMMIT')
    const hash = (r.stdout.split('\n').filter(l => /^[0-9a-f]{7,40}$/i.test(l.trim())).pop() || '').trim()
    return NextResponse.json({
      ok: !nothingToCommit,
      nothingToCommit,
      hash: hash || null,
      logs: (r.stdout || '') + (r.stderr ? '\n' + r.stderr : ''),
    })
  }

  if (action === 'history') {
    // NOTE: the %h|%ad|%s separators are single-quoted — unquoted they would
    // be parsed as bash pipes ("bash: line 1: %s: command not found").
    const r = await runtimeManager.execInProject(
      projectId,
      "git log --pretty=format:'%h|%ad|%s' --date=short -30 2>&1",
      20000,
    )
    const commits = (r.stdout || '')
      .split('\n')
      .filter(Boolean)
      .map(l => {
        const [hash, date, ...rest] = l.split('|')
        return { hash, date, subject: rest.join('|') }
      })
    return NextResponse.json({ ok: r.code === 0, commits })
  }

  if (action === 'discard') {
    // Revert ALL uncommitted changes back to the last commit — destructive,
    // the UI must confirm before calling this.
    const r = await runtimeManager.execInProject(
      projectId,
      'git checkout -- . 2>&1; git clean -fd 2>&1; git status --porcelain=v1 2>&1',
      60000,
    )
    return NextResponse.json({ ok: r.code === 0, logs: (r.stdout || '') + (r.stderr ? '\n' + r.stderr : '') })
  }

  return NextResponse.json({ error: 'unknown action — use status | commit | history | discard' }, { status: 400 })
}
