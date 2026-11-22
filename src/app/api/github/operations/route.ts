import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { runtimeManager } from '@/lib/runtime'
import * as storage from '@/lib/storage'
import { requireProjectAccess, requireUser } from '@/lib/auth'

/**
 * POST /api/github/operations — GitHub REST + git operations driven by a
 * saved GitHubAccount PAT (stored encrypted in GitHubAccount.tokenEnc).
 *
 * Actions:
 *   listRepos  { accountId }                             → { repos }
 *   createRepo { accountId, name, private }              → { repo }
 *   clone      { projectId, accountId, url }             → { ok } (repo → project dir)
 *   push       { projectId, accountId, repo, message }   → { ok } (commit all + push)
 *   pull       { projectId, accountId, repo, mode }      → { ok } (pull/rebase)
 *   sync       { projectId, accountId, repo, message }   → { ok } (commit + pull --rebase + push)
 *
 * v126 CRITICAL FIX: every project dir (projects/<id>) sits INSIDE the
 * platform's own git repo (/home/z/my-project/.git). Git walks UP the tree to
 * find the nearest .git, so a bare `git add -A` in a fresh project dir staged
 * THE ENTIRE PLATFORM SOURCE and pushed it to the user's repo (v123-v125 bug,
 * caught live: the user's repo received src/ prisma/ bun.lock worklog.md
 * instead of the app). push/pull/sync therefore ALWAYS start with the
 * gitIsolatePreamble() guard below.
 *
 * The PAT never leaves the server: it is decrypted per-call and embedded in
 * the https push/clone URL only (x-access-token form). Project-scoped
 * actions go through requireProjectAccess — cross-tenant is impossible.
 */

const GH_API = 'https://api.github.com'

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'CloudAgent-Builder',
    'Content-Type': 'application/json',
  }
}

async function accountFor(accountId: string, callerId?: string, isAdmin = false) {
  const acc = await db.gitHubAccount.findUnique({ where: { id: accountId } })
  if (!acc) return null
  // v123: per-user scoping — an account row belongs to its creator
  // (legacy rows with userId null stay admin-only)
  if (callerId && acc.userId && acc.userId !== callerId && !isAdmin) return null
  if (callerId && !acc.userId && !isAdmin) return null
  let token = ''
  try { token = decrypt(acc.tokenEnc) } catch { return null }
  if (!token) return null
  return { acc, token }
}

/** v123 — resolve the caller for ownership checks (best-effort: bad session → 401 shape). */
async function caller(req: NextRequest) {
  try {
    const u = await requireUser(req)
    return { id: u.id as string | undefined, admin: u.role === 'admin' }
  } catch { return { id: undefined, admin: false } }
}

function tokenUrl(token: string, repoFull: string) {
  return `https://x-access-token:${encodeURIComponent(token)}@github.com/${repoFull}.git`
}

/**
 * v126 — bash preamble that makes the project dir its OWN git repo before any
 * git chain runs inside it:
 *   1. `git rev-parse --show-toplevel` from the project dir resolves to the
 *      PLATFORM ROOT (git walk-up) whenever the project has no local .git —
 *      detect exactly that (toplevel !== $(pwd -P));
 *   2. git init the project dir + set a repo-local identity (fresh repos have
 *      none, commits would otherwise fail);
 *   3. drop a default .gitignore when the project has none so node_modules,
 *      .next and build junk never enter the user's repo.
 */
function gitIsolatePreamble() {
  return (
    `if ! TOP="$(git rev-parse --show-toplevel 2>/dev/null)" || [ "$TOP" != "$(pwd -P)" ]; then ` +
    `git init -q && git config user.email "builder@cloudagent.local" && git config user.name "Cloud Agent Builder"; ` +
    `[ -f .gitignore ] || printf 'node_modules/\\n.next/\\ndist/\\nbuild/\\n__pycache__/\\n.venv/\\n*.log\\n.DS_Store\\n' > .gitignore; ` +
    `fi; `
  )
}

/** v126 — only git-pull when the remote actually has refs (an empty repo
 * would otherwise hard-fail pull/sync on the very first round-trip). */
function remoteHasRefs(remote: string) {
  return `git ls-remote ${remote} HEAD 2>/dev/null | head -1 | grep -q .`
}

function stripToken(text: string, token: string) {
  return text.split(encodeURIComponent(token)).join('***')
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'body required' }, { status: 400 })
  const action = String((body as any).action || '')
  const accountId = String((body as any).accountId || '')

  /* ── repo listing / creation: account-level, no project ── */
  if (action === 'listRepos') {
    const c = await caller(req)
    if (!c.id) return NextResponse.json({ error: 'signed out — please log in' }, { status: 401 })
    const a = await accountFor(accountId, c.id, c.admin)
    if (!a) return NextResponse.json({ error: 'GitHub account not found or token unreadable' }, { status: 404 })
    const r = await fetch(`${GH_API}/user/repos?per_page=100&sort=updated`, { headers: authHeaders(a.token) })
    if (!r.ok) return NextResponse.json({ error: `GitHub API ${r.status}` }, { status: 502 })
    const list = (await r.json()) as any[]
    return NextResponse.json({
      ok: true,
      repos: list.map((x) => ({
        fullName: x.full_name,
        name: x.name,
        private: x.private,
        url: x.html_url,
        updatedAt: x.updated_at,
      })),
    })
  }

  if (action === 'createRepo') {
    const name = String((body as any).name || '').trim()
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const c = await caller(req)
    if (!c.id) return NextResponse.json({ error: 'signed out — please log in' }, { status: 401 })
    const a = await accountFor(accountId, c.id, c.admin)
    if (!a) return NextResponse.json({ error: 'GitHub account not found or token unreadable' }, { status: 404 })
    const r = await fetch(`${GH_API}/user/repos`, {
      method: 'POST',
      headers: authHeaders(a.token),
      body: JSON.stringify({ name, private: (body as any).private !== false, auto_init: false }),
    })
    if (!r.ok) {
      const errText = await r.text().catch(() => '')
      return NextResponse.json({ error: `GitHub API ${r.status} ${errText.slice(0, 200)}` }, { status: 502 })
    }
    const repo = await r.json()
    return NextResponse.json({
      ok: true,
      repo: { fullName: repo.full_name, name: repo.name, private: repo.private, url: repo.html_url },
    })
  }

  /* ── everything below touches a project: ownership required ── */
  const projectId = String((body as any).projectId || '')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const c = await caller(req)
  const a = await accountFor(accountId, c.id, c.admin)
  if (!a) return NextResponse.json({ error: 'GitHub account not found or token unreadable' }, { status: 404 })
  const clean = (s: string) => stripToken(String(s || ''), a.token).slice(-800)

  if (action === 'clone') {
    const url = String((body as any).url || '').trim()
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/i.test(url)) {
      return NextResponse.json({ error: 'url must be a https://github.com/owner/repo URL' }, { status: 400 })
    }
    const repoFull = url.replace(/^https:\/\/github\.com\//i, '').replace(/\.git$/i, '')
    const cloneUrl = tokenUrl(a.token, repoFull)
    // clone into a clean temp dir, then replace the project workspace contents
    const r = await runtimeManager.execInProject(
      projectId,
      `rm -rf /tmp/ca-clone-$PPID 2>/dev/null; git clone --depth 50 '${cloneUrl}' /tmp/ca-clone 2>&1 && rm -rf /tmp/ca-clone/.git && find . -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} + 2>&1; cp -a /tmp/ca-clone/. . 2>&1 && rm -rf /tmp/ca-clone && echo CLONE_OK`,
      300000,
    )
    if (!String(r.stdout || '').includes('CLONE_OK')) {
      return NextResponse.json({ ok: false, error: clean(r.stdout + (r.stderr ? '\n' + r.stderr : '')) || 'clone failed' }, { status: 500 })
    }
    // re-index files after the workspace changed wholesale
    const tree = storage.listTree(projectId, '.')
    const walk = (n: any): Array<{ path: string; isDir: boolean }> => {
      const out: Array<{ path: string; isDir: boolean }> = []
      if (!n) return out
      if (n.type === 'file') out.push({ path: n.path, isDir: false })
      else for (const c of n.children || []) out.push(...walk(c))
      return out
    }
    const entries = walk(tree)
    await db.file.deleteMany({ where: { projectId } })
    for (const e of entries) {
      await db.file.create({ data: { projectId, path: e.path, isDir: e.isDir, content: '' } }).catch(() => {})
    }
    return NextResponse.json({ ok: true, fileCount: entries.filter((e) => !e.isDir).length })
  }

  const repoFull = String((body as any).repo || '').trim()
  const message = String((body as any).message || 'Update from Cloud Agent').slice(0, 500)
  const remote = repoFull ? tokenUrl(a.token, repoFull) : ''
  const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`

  if (action === 'push') {
    if (!remote) return NextResponse.json({ error: 'repo required (owner/name)' }, { status: 400 })
    const r = await runtimeManager.execInProject(
      projectId,
      gitIsolatePreamble() +
      `git add -A 2>&1 && (git diff --cached --quiet && echo NOTHING_TO_COMMIT || git commit -m ${quote(message)} 2>&1) && git push ${remote} HEAD 2>&1 && echo PUSH_OK`,
      300000,
    )
    const out = clean(r.stdout)
    if (out.includes('NOTHING_TO_COMMIT')) return NextResponse.json({ ok: true, nothingToCommit: true })
    if (!out.includes('PUSH_OK')) return NextResponse.json({ ok: false, error: out || 'push failed' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'pull') {
    if (!remote) return NextResponse.json({ error: 'repo required (owner/name)' }, { status: 400 })
    const mode = (body as any).mode === 'rebase' ? 'rebase' : 'merge'
    const r = await runtimeManager.execInProject(
      projectId,
      gitIsolatePreamble() +
      `git add -A 2>&1 && git commit -m "Pre-pull checkpoint (Cloud Agent)" --allow-empty 2>&1; ` +
      `if ${remoteHasRefs(remote)}; then git pull --${mode === 'rebase' ? 'rebase' : 'no-rebase --allow-unrelated-histories'} ${remote} 2>&1 && echo PULL_OK; else echo PULL_OK; fi`,
      300000,
    )
    const out = clean(r.stdout)
    if (!out.includes('PULL_OK')) return NextResponse.json({ ok: false, error: out || 'pull failed' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'sync') {
    if (!remote) return NextResponse.json({ error: 'repo required (owner/name)' }, { status: 400 })
    const r = await runtimeManager.execInProject(
      projectId,
      gitIsolatePreamble() +
      `git add -A 2>&1 && (git diff --cached --quiet || git commit -m ${quote(message)} 2>&1); ` +
      `if ${remoteHasRefs(remote)}; then git pull --rebase ${remote} 2>&1; fi; ` +
      `git push ${remote} HEAD 2>&1 && echo SYNC_OK`,
      300000,
    )
    const out = clean(r.stdout)
    if (!out.includes('SYNC_OK')) return NextResponse.json({ ok: false, error: out || 'sync failed' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: `unknown action: ${action}`, hint: 'status | commit | discard live in /api/git; listRepos | createRepo | clone | push | pull | sync live here' }, { status: 400 })
}
