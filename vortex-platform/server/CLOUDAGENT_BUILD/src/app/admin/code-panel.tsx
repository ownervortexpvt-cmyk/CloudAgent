'use client'

/**
 * CODE HUB (v152) — the ecosystem's own code section in the control room.
 *
 * Everything the owner asked for, in one tab:
 *   • the whole ecosystem's code browsable in place (CloudAgent + VORTEX_SERVER)
 *   • create Git access tokens (shown exactly once, stored hashed)
 *   • clone URL for ANY editor (VS Code, terminal, …) — no GitHub, no Cloudflare
 *   • push-to-live deploy pipeline status + history + manual redeploy
 *
 * Backed by /api/admin/panel/code-hub (double-gated server-side) and the
 * token-gated smart-HTTP git server at /api/ecosystem-git/vortex-ecosystem.git.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { afetch } from './admin-client'

/* ───────────────────────── shared mini-bits ───────────────────────── */

function Card({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="border border-zinc-800/80 rounded-xl bg-zinc-950/60 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-zinc-800/80 flex items-center justify-between gap-2">
        <h2 className="text-xs font-mono font-semibold text-zinc-400 uppercase tracking-wider">{title}</h2>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: 'emerald' | 'amber' | 'red' | 'plain' }) {
  const toneCls = tone === 'emerald' ? 'text-emerald-400' : tone === 'amber' ? 'text-amber-400' : tone === 'red' ? 'text-red-400' : 'text-zinc-100'
  return (
    <div className="border border-zinc-800/80 rounded-xl bg-zinc-950/60 p-4">
      <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold font-mono ${toneCls} break-all`}>{value}</div>
      {sub && <div className="text-[11px] text-zinc-600 mt-0.5">{sub}</div>}
    </div>
  )
}

function CopyBtn({ text, label = 'copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      size="sm"
      variant="outline"
      className="border-zinc-700 text-zinc-300 hover:bg-zinc-900 shrink-0"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text) } catch { /* clipboard denied */ }
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
    >
      {done ? 'copied ✓' : label}
    </Button>
  )
}

const DEPLOY_TONE: Record<string, 'emerald' | 'amber' | 'red' | 'plain'> = {
  live: 'emerald',
  failed: 'red',
  interrupted: 'red',
  building: 'amber',
  restarting: 'amber',
  queued: 'amber',
  running: 'amber',
  idle: 'plain',
}

const fmt = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`)

/* ─────────────────────────── the panel ─────────────────────────── */

interface EcoTokenRow { id: string; name: string; tail: string; createdAt: number; lastUsedAt?: number; lastUsedIp?: string }
interface DeployStep { name: string; status: string; detail?: string }
interface DeployState { status: string; trigger?: string; actor?: string; commit?: string | null; startedAt?: number; durationMs?: number; steps?: DeployStep[]; lastError?: string | null; note?: string }
interface HistoryRow { status: string; trigger: string; actor?: string; commit?: string; durationMs?: number; error?: string; at: number }
interface RepoInfo { ready: boolean; branch: string; head: string | null; headSubject: string | null; headDate: string | null; trackedFiles: number; repoSizeMB: number }
interface Overview {
  cloneUrl: string; repoName: string; repo: RepoInfo; deploy: DeployState; history: HistoryRow[];
  vortexHealth: string; cloudagentMode: string; host: string;
}
interface TreeEntry { name: string; type: 'dir' | 'file'; size: number }

export function CodePanel() {
  const [ov, setOv] = useState<Overview | null>(null)
  const [tokens, setTokens] = useState<EcoTokenRow[]>([])
  const [newName, setNewName] = useState('')
  const [freshToken, setFreshToken] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')

  // code browser state
  const [cwd, setCwd] = useState('')
  const [entries, setEntries] = useState<TreeEntry[]>([])
  const [fileView, setFileView] = useState<{ path: string; content: string; binary?: boolean; truncated?: boolean } | null>(null)
  const [loadingTree, setLoadingTree] = useState(false)

  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const a = await afetch('/api/admin/panel/code-hub?view=overview')
      setOv(a)
    } catch (e: any) { setMsg(`overview failed: ${e.message}`) }
    try {
      const t = await afetch('/api/admin/panel/code-hub?view=tokens')
      setTokens(t.tokens || [])
    } catch { /* keep old list */ }
  }, [])

  const loadTree = useCallback(async (rel: string) => {
    setLoadingTree(true)
    try {
      const j = await afetch(`/api/admin/panel/code-hub?view=tree&path=${encodeURIComponent(rel)}`)
      setEntries(j.entries || [])
      setCwd(rel)
    } catch (e: any) { setMsg(`browse failed: ${e.message}`) }
    finally { setLoadingTree(false) }
  }, [])

  const openFile = useCallback(async (rel: string) => {
    setLoadingTree(true)
    try {
      const j = await afetch(`/api/admin/panel/code-hub?view=file&path=${encodeURIComponent(rel)}`)
      setFileView({ path: rel, content: j.content || '', binary: j.binary, truncated: j.truncated })
    } catch (e: any) { setMsg(`open failed: ${e.message}`) }
    finally { setLoadingTree(false) }
  }, [])

  useEffect(() => {
    load()
    loadTree('')
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [load, loadTree])

  // live polling only while a deploy is mid-flight
  useEffect(() => {
    const mid = ov && ['building', 'restarting', 'queued', 'running'].includes(ov.deploy?.status)
    if (mid && !timer.current) timer.current = setInterval(load, 4000)
    if (!mid && timer.current) { clearInterval(timer.current); timer.current = null }
    return () => { if (timer.current) { clearInterval(timer.current); timer.current = null } }
  }, [ov?.deploy?.status, load])

  const createToken = async () => {
    setBusy('create'); setMsg(''); setFreshToken('')
    try {
      const j = await afetch('/api/admin/panel/code-hub', { method: 'POST', body: JSON.stringify({ action: 'create-token', name: newName || 'editor' }) })
      setFreshToken(j.token || '')
      setNewName('')
      const t = await afetch('/api/admin/panel/code-hub?view=tokens')
      setTokens(t.tokens || [])
    } catch (e: any) { setMsg(`create failed: ${e.message}`) }
    finally { setBusy('') }
  }

  const revokeToken = async (id: string, name: string) => {
    if (!confirm(`Revoke "${name}"? Editors using it will immediately lose access.`)) return
    setBusy(`revoke-${id}`); setMsg('')
    try {
      await afetch('/api/admin/panel/code-hub', { method: 'POST', body: JSON.stringify({ action: 'revoke-token', id }) })
      const t = await afetch('/api/admin/panel/code-hub?view=tokens')
      setTokens(t.tokens || [])
      setMsg(`token "${name}" revoked — access is dead from this instant`)
    } catch (e: any) { setMsg(`revoke failed: ${e.message}`) }
    finally { setBusy('') }
  }

  const redeploy = async () => {
    setBusy('redeploy'); setMsg('')
    try {
      const j = await afetch('/api/admin/panel/code-hub', { method: 'POST', body: JSON.stringify({ action: 'redeploy' }) })
      setMsg(j.ok ? 'redeploy queued — pipeline is running, status below updates live' : `redeploy failed: ${j.error}`)
    } catch (e: any) { setMsg(`redeploy failed: ${e.message}`) }
    finally { setBusy(''); load() }
  }

  if (!ov) {
    return <div className="font-mono text-sm text-zinc-600 animate-pulse">loading code hub…{msg ? ` (${msg})` : ''}</div>
  }

  const repo = ov.repo || ({} as RepoInfo)
  const deploy = ov.deploy || { status: 'idle' }
  const steps: DeployStep[] = deploy.steps || []
  const stepState = (n: string) => steps.find((s) => s.name === n)?.status || 'pending'
  const midFlight = ['building', 'restarting', 'queued', 'running'].includes(deploy.status)

  const crumbs = cwd ? cwd.split('/') : []
  const cloneCmd = `git clone ${ov.cloneUrl.replace('://', '://vortex:<TOKEN>@')}`

  return (
    <div className="space-y-5">
      {/* ── REPOSITORY ── */}
      <Card title="Ecosystem repository — the whole codebase, self-hosted">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Repo" value={repo.ready ? 'READY' : 'MISSING'} tone={repo.ready ? 'emerald' : 'red'} sub={`${repo.branch || 'main'} branch`} />
          <Stat label="Tracked files" value={repo.trackedFiles ?? '—'} sub="CloudAgent + VORTEX_SERVER + scripts" />
          <Stat label="Repo size" value={repo.repoSizeMB ? `${repo.repoSizeMB} MB` : '—'} sub="bare git store" />
          <Stat label="VORTEX :3200" value={ov.vortexHealth === '200' ? 'HEALTHY' : `HTTP ${ov.vortexHealth}`} tone={ov.vortexHealth === '200' ? 'emerald' : 'red'} sub={`CloudAgent ${ov.cloudagentMode}`} />
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate rounded bg-black border border-zinc-800 px-3 py-2 text-xs text-emerald-300 font-mono">{ov.cloneUrl}</code>
            <CopyBtn text={ov.cloneUrl} label="copy URL" />
          </div>
          <p className="text-xs text-zinc-500">
            Clone in any editor — VS Code, terminal, anything that speaks git. Username is anything (e.g. <span className="font-mono text-zinc-400">vortex</span>), your access token below is the password:
          </p>
          <code className="block rounded bg-black border border-zinc-800 px-3 py-2 text-[11px] text-zinc-400 font-mono overflow-x-auto whitespace-pre">{cloneCmd}</code>
          {repo.head ? (
            <p className="text-[11px] text-zinc-600 font-mono truncate">
              HEAD {String(repo.head).slice(0, 8)} — {repo.headSubject || '—'} · {repo.headDate ? new Date(repo.headDate).toLocaleString('en-IN') : ''}
            </p>
          ) : null}
        </div>
      </Card>

      {/* ── TOKENS ── */}
      <Card title={`Git access tokens (${tokens.length}) — password for every editor`}>
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="token name — e.g. vscode-laptop"
            className="bg-black border-zinc-800 font-mono text-xs max-w-xs"
            onKeyDown={(e) => { if (e.key === 'Enter' && !busy) createToken() }}
          />
          <Button onClick={createToken} disabled={busy === 'create'} className="bg-emerald-600 hover:bg-emerald-500 text-white">
            {busy === 'create' ? 'creating…' : 'Create token'}
          </Button>
        </div>

        {freshToken ? (
          <div className="mt-3 rounded-lg border border-emerald-800 bg-emerald-950/40 p-3 space-y-2">
            <p className="text-xs text-emerald-300 font-semibold">⚠ Copy it NOW — this is the only time the full token is ever shown. Only its SHA-256 hash is stored.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 break-all rounded bg-black border border-emerald-900 px-3 py-2 text-xs text-emerald-300 font-mono">{freshToken}</code>
              <CopyBtn text={freshToken} label="copy token" />
            </div>
          </div>
        ) : null}

        <div className="mt-3">
          {tokens.length === 0 ? (
            <p className="text-sm text-zinc-600">No tokens yet — create one above to connect your editor.</p>
          ) : (
            <div className="divide-y divide-zinc-800/80">
              {tokens.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm text-zinc-200 font-mono truncate">
                      {t.name} <span className="text-zinc-600">·•••••{t.tail}</span>
                    </div>
                    <div className="text-[11px] text-zinc-600">
                      created {new Date(t.createdAt).toLocaleString('en-IN')}
                      {t.lastUsedAt ? ` · last used ${new Date(t.lastUsedAt).toLocaleString('en-IN')}${t.lastUsedIp ? ` from ${t.lastUsedIp}` : ''}` : ' · never used'}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="border-red-900 text-red-400 hover:bg-red-950/50 shrink-0"
                    onClick={() => revokeToken(t.id, t.name)} disabled={busy === `revoke-${t.id}`}>
                    {busy === `revoke-${t.id}` ? 'revoking…' : 'Revoke'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* ── DEPLOY PIPELINE ── */}
      <Card title="Push → live deploy" right={
        <Button onClick={redeploy} disabled={busy === 'redeploy' || midFlight}
          className="bg-sky-600 hover:bg-sky-500 text-white">
          {midFlight ? 'deploy running…' : busy === 'redeploy' ? 'queueing…' : 'Redeploy now'}
        </Button>
      }>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Status" value={deploy.status?.toUpperCase() || 'IDLE'} tone={DEPLOY_TONE[deploy.status] || 'plain'}
            sub={deploy.actor ? `by ${deploy.actor}` : 'waiting for a push'} />
          <Stat label="Commit" value={deploy.commit ? String(deploy.commit).slice(0, 8) : '—'} sub={deploy.trigger ? `trigger: ${deploy.trigger}` : ''} />
          <Stat label="Duration" value={deploy.durationMs ? `${(deploy.durationMs / 1000).toFixed(1)}s` : '—'} sub="last pipeline run" />
          <Stat label="Data safety" value="PRESERVED" tone="emerald" sub="db · uploads · tokens never touched" />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-mono">
          {['checkout', 'deps', 'build', 'restart'].map((n, i) => {
            const st = stepState(n)
            const cls = st === 'done' ? 'border-emerald-900 bg-emerald-950/50 text-emerald-400'
              : st === 'running' ? 'border-amber-800 bg-amber-950/50 text-amber-300 animate-pulse'
              : st === 'failed' ? 'border-red-900 bg-red-950/50 text-red-400'
              : 'border-zinc-800 bg-zinc-950 text-zinc-600'
            return (
              <span key={n} className={`inline-flex items-center gap-1 rounded border px-2 py-1 ${cls}`}>
                {i > 0 && <span className="text-zinc-700 mr-1">→</span>}
                {st === 'done' ? '✓' : st === 'running' ? '◐' : st === 'failed' ? '✗' : '·'} {n}
              </span>
            )
          })}
        </div>

        {deploy.lastError ? (
          <pre className="mt-3 max-h-32 overflow-auto rounded bg-red-950/30 border border-red-900 p-2 text-[10px] leading-4 text-red-300 whitespace-pre-wrap">{deploy.lastError}</pre>
        ) : null}
        {deploy.note ? <p className="mt-2 text-xs text-amber-400">{deploy.note}</p> : null}

        <div className="mt-3">
          <h3 className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 mb-1.5">Deploy history</h3>
          {(ov.history || []).length === 0 ? (
            <p className="text-xs text-zinc-600">No deploys yet — push from your editor, or hit Redeploy now.</p>
          ) : (
            <div className="divide-y divide-zinc-800/80 max-h-44 overflow-auto">
              {ov.history.map((h, i) => (
                <div key={i} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                  <span className={`font-mono ${h.status === 'live' ? 'text-emerald-400' : 'text-red-400'}`}>{h.status === 'live' ? '✓ LIVE' : '✗ FAILED'}</span>
                  <span className="text-zinc-400 font-mono">{h.commit || '—'}</span>
                  <span className="text-zinc-600 truncate">{h.trigger}{h.actor ? ` · ${h.actor}` : ''}</span>
                  <span className="text-zinc-500 font-mono">{h.durationMs ? `${(h.durationMs / 1000).toFixed(1)}s` : ''}</span>
                  <span className="text-zinc-600 shrink-0">{new Date(h.at).toLocaleTimeString('en-IN')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">
          Every <span className="font-mono text-zinc-400">git push</span> from your editor triggers this automatically: checkout → deps (only if manifests changed) → VORTEX build → restart :3200.
          CloudAgent edits go live instantly (dev/HMR) — code updates only, runtime data is never reset or recycled.
        </p>
      </Card>

      {/* ── CODE BROWSER ── */}
      <Card title="Code browser — the whole ecosystem, read-only">
        <div className="flex items-center gap-2 flex-wrap text-xs font-mono">
          <button className={`px-2 py-1 rounded ${cwd === '' ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-900' : 'text-sky-400 hover:underline'}`} onClick={() => { setFileView(null); loadTree('') }}>
            ecosystem/
          </button>
          {crumbs.map((c, i) => {
            const p = crumbs.slice(0, i + 1).join('/')
            return (
              <span key={i} className="inline-flex items-center gap-2">
                <span className="text-zinc-700">/</span>
                <button className={`px-2 py-1 rounded ${p === cwd ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-900' : 'text-sky-400 hover:underline'}`}
                  onClick={() => { setFileView(null); loadTree(p) }}>
                  {c}
                </button>
              </span>
            )
          })}
          {loadingTree ? <span className="text-zinc-600 animate-pulse">loading…</span> : null}
        </div>

        {fileView ? (
          <div className="mt-3">
            <div className="flex items-center justify-between gap-2">
              <code className="text-xs text-zinc-300 font-mono truncate">{fileView.path}</code>
              <Button size="sm" variant="outline" className="border-zinc-700 text-zinc-400" onClick={() => setFileView(null)}>close</Button>
            </div>
            <pre className="mt-2 max-h-96 overflow-auto rounded bg-black border border-zinc-800 p-3 text-[11px] leading-4 text-zinc-300 whitespace-pre-wrap">
              {fileView.binary || fileView.truncated ? fileView.content : fileView.content}
            </pre>
          </div>
        ) : (
          <div className="mt-3 divide-y divide-zinc-800/60 max-h-96 overflow-auto">
            {entries.length === 0 && !loadingTree ? <p className="text-sm text-zinc-600 py-2">empty directory</p> : null}
            {entries.map((e) => (
              <button key={`${e.type}-${e.name}`}
                className="w-full flex items-center justify-between gap-3 py-1.5 text-left hover:bg-zinc-900/60 px-2 rounded"
                onClick={() => {
                  const rel = cwd ? `${cwd}/${e.name}` : e.name
                  if (e.type === 'dir') { setFileView(null); loadTree(rel) } else { openFile(rel) }
                }}>
                <span className={`font-mono text-xs truncate ${e.type === 'dir' ? 'text-sky-300' : 'text-zinc-300'}`}>
                  {e.type === 'dir' ? '▸' : '·'} {e.name}{e.type === 'dir' ? '/' : ''}
                </span>
                <span className="text-[10px] text-zinc-600 shrink-0">{e.type === 'file' ? fmt(e.size) : ''}</span>
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] text-zinc-500">
          Runtime data (databases, uploads, builds, git store) is hidden here and never enters the repo — pushes carry code only.
        </p>
      </Card>

      {msg ? <p className="rounded border border-sky-800 bg-sky-950/40 p-2 text-xs text-sky-300">{msg}</p> : null}
    </div>
  )
}
