'use client'

import { useEffect, useState } from 'react'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Github, Plus, Trash2, GitBranch, Download as DownloadIcon, RefreshCw, Loader2,
  Upload, ExternalLink, CheckCircle2, XCircle, ShieldCheck, GitFork, GitCommitHorizontal, History,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/lib/store'

interface GitHubAccount {
  id: string
  name: string
  username?: string | null
  defaultOwner?: string | null
  tokenMasked?: string
}

interface Repo {
  id: number
  name: string
  full_name: string
  private: boolean
  clone_url: string
  html_url: string
  language: string | null
  updated_at: string
}

// v74 — project-local git status payload from /api/git
interface GitStatus {
  ok: boolean
  initialized?: boolean
  branch?: string
  clean?: boolean
  counts?: { added: number; modified: number; deleted: number; total: number }
  entries?: Array<{ x: string; y: string; path: string; origPath?: string }>
  recent?: string[]
  error?: string
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'failed'

export function GitHubPanel() {
  const { githubPanelOpen, setGithubPanelOpen, activeProject, bumpTree } = useAppStore()
  const [accounts, setAccounts] = useState<GitHubAccount[]>([])
  const [selectedAccount, setSelectedAccount] = useState<string>('')
  const [repos, setRepos] = useState<Repo[]>([])
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [newRepoName, setNewRepoName] = useState('')
  const [commitMsg, setCommitMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [connectionError, setConnectionError] = useState('')

  // Token input state
  const [tokenInput, setTokenInput] = useState('')
  const [accountName, setAccountName] = useState('')
  const [usernameInput, setUsernameInput] = useState('')

  // v74 — project-local git state (works without any GitHub account)
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [gitLoading, setGitLoading] = useState(false)
  const [gitMsg, setGitMsg] = useState('')

  async function loadAccounts() {
    const res = await fetch('/api/github')
    const data = await res.json()
    setAccounts(data.accounts || [])
    if (data.accounts?.length && !selectedAccount) {
      setSelectedAccount(data.accounts[0].id)
      setConnectionState('connected')
    } else if (!data.accounts?.length) {
      setConnectionState('disconnected')
    }
  }

  useEffect(() => {
    if (githubPanelOpen) loadAccounts()
  }, [githubPanelOpen])

  // v74 — project git helpers
  async function loadGitStatus() {
    if (!activeProject) return
    setGitLoading(true)
    setGitMsg('')
    try {
      const res = await fetch('/api/git', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status', projectId: activeProject.id }),
      })
      const data: GitStatus = await res.json()
      setGitStatus(data)
      if (data.initialized) toast.success('Git repository initialized for this project')
    } catch (e: any) {
      setGitStatus({ ok: false, error: e.message })
    } finally {
      setGitLoading(false)
    }
  }

  async function gitCommit() {
    if (!activeProject) return
    setGitLoading(true)
    try {
      const res = await fetch('/api/git', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'commit', projectId: activeProject.id, message: commitMsg || 'Update from Cloud Agent' }),
      })
      const data = await res.json()
      if (data.nothingToCommit) { setGitMsg('Nothing to commit — working tree clean'); toast.info('Nothing to commit') }
      else if (data.ok) { setGitMsg(`Committed ${data.hash}`); toast.success(`Committed ${data.hash}`); setCommitMsg('') }
      else { setGitMsg('Commit failed'); toast.error('Commit failed') }
      await loadGitStatus()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setGitLoading(false)
    }
  }

  async function gitDiscard() {
    if (!activeProject) return
    if (!confirm('Discard ALL uncommitted changes in this project? This cannot be undone.')) return
    setGitLoading(true)
    try {
      const res = await fetch('/api/git', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'discard', projectId: activeProject.id }),
      })
      const data = await res.json()
      if (data.ok) { toast.success('Changes discarded — back to last commit'); bumpTree(); loadGitStatus() }
      else toast.error('Discard failed')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setGitLoading(false)
    }
  }

  useEffect(() => {
    if (githubPanelOpen && activeProject) loadGitStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [githubPanelOpen, activeProject?.id])

  // Step 1: Connect to GitHub — enter token
  async function connectToGitHub() {
    if (!tokenInput) {
      toast.error('GitHub token required')
      return
    }
    setConnectionState('connecting')
    setBusy(true)
    try {
      // Step 2: Login — verify the token by calling GitHub API
      const verifyRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${tokenInput}`, Accept: 'application/vnd.github+json' },
      })
      if (!verifyRes.ok) {
        throw new Error(`GitHub rejected the token (HTTP ${verifyRes.status}). Check your token.`)
      }
      const userInfo = await verifyRes.json()

      // Step 3: Authorize — save the account
      const res = await fetch('/api/github', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: accountName || userInfo.login || 'My GitHub',
          token: tokenInput,
          username: userInfo.login,
        }),
      })
      const data = await res.json()

      if (data.account) {
        // Step 4: Connected ✓
        setConnectionState('connected')
        setSelectedAccount(data.account.id)
        toast.success(`✓ Connected to GitHub as @${userInfo.login}`)
        setTokenInput('')
        setAccountName('')
        setUsernameInput('')
        loadAccounts()
      } else {
        throw new Error(data.error || 'Failed to save account')
      }
    } catch (e: any) {
      setConnectionState('failed')
      setConnectionError(e.message)
      toast.error(`✗ Connection failed: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function removeAccount(id: string) {
    if (!confirm('Remove this GitHub account?')) return
    await fetch(`/api/github?id=${id}`, { method: 'DELETE' })
    toast.success('Account removed')
    setConnectionState('disconnected')
    loadAccounts()
  }

  async function listRepos() {
    if (!selectedAccount) return
    setLoadingRepos(true)
    try {
      const res = await fetch('/api/github/operations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'listRepos', accountId: selectedAccount }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setRepos(data.repos || [])
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoadingRepos(false)
    }
  }

  async function cloneRepo(url: string) {
    if (!activeProject) return
    if (!confirm('Cloning will REPLACE all project files. Continue?')) return
    setBusy(true)
    try {
      const res = await fetch('/api/github/operations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clone', projectId: activeProject.id, accountId: selectedAccount, url }),
      })
      const data = await res.json()
      if (data.ok) { toast.success('Repository cloned'); bumpTree() }
      else toast.error('Clone failed')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function createRepo() {
    if (!newRepoName) return toast.error('Repository name required')
    setBusy(true)
    try {
      const res = await fetch('/api/github/operations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'createRepo', accountId: selectedAccount, name: newRepoName, private: true }),
      })
      const data = await res.json()
      if (data.repo) {
        toast.success(`Created ${data.repo.full_name}`)
        listRepos()
      } else {
        toast.error(data.error || 'create failed')
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function pushRepo(repoFullName: string) {
    if (!activeProject) return
    if (!commitMsg) return toast.error('Commit message required')
    setBusy(true)
    try {
      const res = await fetch('/api/github/operations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'push', projectId: activeProject.id, accountId: selectedAccount, repo: repoFullName, message: commitMsg }),
      })
      const data = await res.json()
      if (data.ok) toast.success('Pushed successfully')
      else toast.error('Push failed — check your repo access')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  // v71 — Pull (merge / hard reset) + Sync: the two live operations that had
  // NO UI button. Pull brings the GitHub repo into this project (merge by
  // default, reset overwrites local files with the remote); Sync = pull +
  // commit + push in one shot.
  async function gitPull(repoFullName: string, mode: 'merge' | 'reset') {
    if (!activeProject) return toast.error('Open a project first')
    if (mode === 'reset' && !confirm(`This will OVERWRITE all local files of "${activeProject.name}" with ${repoFullName}. Continue?`)) return
    setBusy(true)
    try {
      const res = await fetch('/api/github/operations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pull', projectId: activeProject.id, accountId: selectedAccount, repo: repoFullName, mode }),
      })
      const data = await res.json()
      if (data.ok) {
        toast.success(mode === 'reset' ? 'Pulled (reset) — project now matches GitHub' : 'Pulled & merged')
        bumpTree()
      } else {
        toast.error('Pull failed — see the console for details')
        console.error('[github pull]', data.logs || data.error)
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function gitSync(repoFullName: string) {
    if (!activeProject) return toast.error('Open a project first')
    setBusy(true)
    try {
      const res = await fetch('/api/github/operations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync', projectId: activeProject.id, accountId: selectedAccount, repo: repoFullName, message: commitMsg || `Sync from Cloud Agent` }),
      })
      const data = await res.json()
      if (data.ok) {
        toast.success('Synced — pulled remote changes and pushed local ones')
        bumpTree()
      } else {
        toast.error('Sync failed — check the repo exists and you have push access')
        console.error('[github sync]', data.logs || data.error)
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={githubPanelOpen} onOpenChange={setGithubPanelOpen}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Github className="w-5 h-5" /> GitHub
          </SheetTitle>
          <SheetDescription>
            Connect your GitHub account to clone, create, and push repositories.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Connection Status Banner */}
          <div className={`flex items-center gap-3 p-3 rounded-lg border ${
            connectionState === 'connected' ? 'bg-emerald-500/10 border-emerald-500/30' :
            connectionState === 'failed' ? 'bg-red-500/10 border-red-500/30' :
            connectionState === 'connecting' ? 'bg-blue-500/10 border-blue-500/30' :
            'bg-muted/30 border-border'
          }`}>
            {connectionState === 'connected' && <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />}
            {connectionState === 'failed' && <XCircle className="w-5 h-5 text-red-500 shrink-0" />}
            {connectionState === 'connecting' && <Loader2 className="w-5 h-5 text-blue-500 shrink-0 animate-spin" />}
            {connectionState === 'disconnected' && <Github className="w-5 h-5 text-muted-foreground shrink-0" />}
            <div className="flex-1 min-w-0">
              {connectionState === 'connected' && (
                <div>
                  <p className="text-sm font-medium text-emerald-500">Connected ✓</p>
                  <p className="text-xs text-muted-foreground">
                    {accounts.find(a => a.id === selectedAccount)?.name || 'GitHub account connected'}
                  </p>
                </div>
              )}
              {connectionState === 'failed' && (
                <div>
                  <p className="text-sm font-medium text-red-500">Connection Failed ✗</p>
                  <p className="text-xs text-muted-foreground">{connectionError}</p>
                </div>
              )}
              {connectionState === 'connecting' && (
                <p className="text-sm font-medium text-blue-500">Connecting to GitHub…</p>
              )}
              {connectionState === 'disconnected' && (
                <p className="text-sm text-muted-foreground">Not connected. Enter your GitHub token below.</p>
              )}
            </div>
            {connectionState === 'connected' && accounts.length > 0 && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeAccount(selectedAccount)}>
                <Trash2 className="w-3.5 h-3.5 text-destructive" />
              </Button>
            )}
          </div>

          {/* Step 1: Connect — Token input (shown when disconnected or failed) */}
          {connectionState !== 'connected' && (
            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-medium">Step 1: Connect to GitHub</h3>
              </div>
              <div>
                <Label htmlFor="gh-name">Account name (display only)</Label>
                <Input id="gh-name" value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="My GitHub" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="gh-username">GitHub username</Label>
                <Input id="gh-username" value={usernameInput} onChange={(e) => setUsernameInput(e.target.value)} placeholder="your-username" className="mt-1" />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="gh-token">GitHub Personal Access Token (PAT)</Label>
                  <a href="https://github.com/settings/tokens/new?scopes=repo,user&description=Cloud%20Agent" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                    🔑 Create token →
                  </a>
                </div>
                <Input id="gh-token" type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="ghp_..." className="mt-1 font-mono text-xs" />
              </div>
              <Button className="w-full" onClick={connectToGitHub} disabled={busy || !tokenInput}>
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Github className="w-4 h-4 mr-2" />}
                Connect & Authorize
              </Button>
              <p className="text-xs text-muted-foreground">
                Token needs <code>repo</code> and <code>user</code> scopes. Token is encrypted at rest and never exposed to the client.
              </p>
            </Card>
          )}

          {/* Step 2: Connected — Show repos, create, push */}
          {connectionState === 'connected' && (
            <Tabs defaultValue="repos">
              <TabsList className="w-full">
                <TabsTrigger value="repos" className="flex-1"><GitFork className="w-3.5 h-3.5 mr-1" />Repos</TabsTrigger>
                <TabsTrigger value="create" className="flex-1"><Plus className="w-3.5 h-3.5 mr-1" />Create</TabsTrigger>
                <TabsTrigger value="push" className="flex-1"><Upload className="w-3.5 h-3.5 mr-1" />Push</TabsTrigger>
                <TabsTrigger value="pull" className="flex-1"><DownloadIcon className="w-3.5 h-3.5 mr-1" />Pull</TabsTrigger>
              </TabsList>

              <TabsContent value="repos" className="mt-3">
                <Button size="sm" onClick={listRepos} disabled={loadingRepos} className="w-full mb-3">
                  {loadingRepos ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
                  List my repositories
                </Button>
                {repos.length > 0 && (
                  <div className="space-y-1 max-h-72 overflow-y-auto">
                    {repos.map(r => (
                      <div key={r.id} className="flex items-center gap-2 p-2 border border-border rounded text-xs">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{r.full_name}</div>
                          <div className="text-muted-foreground text-[10px]">{r.language || 'unknown'} · {r.private ? 'private' : 'public'}</div>
                        </div>
                        <a href={r.html_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        <Button size="sm" variant="outline" className="h-6" disabled={busy} onClick={() => cloneRepo(r.clone_url)}>
                          <DownloadIcon className="w-3 h-3 mr-1" />Clone
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="create" className="mt-3 space-y-2">
                <Label>New repository name</Label>
                <Input value={newRepoName} onChange={(e) => setNewRepoName(e.target.value)} placeholder="my-new-app" />
                <Button size="sm" onClick={createRepo} disabled={busy || !newRepoName} className="w-full">
                  <Plus className="w-3.5 h-3.5 mr-1" />Create private repository
                </Button>
                <p className="text-xs text-muted-foreground">The repo will be created under your GitHub account.</p>
              </TabsContent>

              <TabsContent value="push" className="mt-3 space-y-2">
                <Label>Commit message</Label>
                <Input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder="Update from Cloud Agent" />
                <Label>Target repo (owner/name)</Label>
                <PushForm onPush={pushRepo} busy={busy} />
                <p className="text-xs text-muted-foreground">
                  This will: <code>git add -A</code> → <code>git commit</code> → <code>git push -u origin HEAD</code>
                </p>
              </TabsContent>

              {/* v71 — Pull & Sync tab: the two live operations that previously had no button */}
              <TabsContent value="pull" className="mt-3 space-y-2">
                {!activeProject ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">Open a project first — pull/sync work on the OPEN project.</p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Project: <span className="font-medium text-foreground">{activeProject.name}</span> · repo (owner/name)
                    </p>
                    <PullSyncForm busy={busy} onPull={gitPull} onSync={gitSync} />
                    <p className="text-xs text-muted-foreground">
                      <b>Pull merge</b> keeps your local changes and merges the remote in. <b>Pull reset</b> overwrites
                      ALL local files with GitHub. <b>Sync</b> pulls, commits, and pushes in one shot.
                    </p>
                  </>
                )}
              </TabsContent>
            </Tabs>
          )}

          {/* v74 — Project Git: local status/commit/history. Works with or
              without a GitHub account — every project gets a real local repo. */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-medium">Project Git</h3>
                {gitStatus?.branch && <Badge variant="outline" className="text-[10px]">{gitStatus.branch}</Badge>}
                {gitStatus?.clean && <Badge className="text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">clean</Badge>}
                {gitStatus && !gitStatus.clean && (
                  <Badge className="text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">
                    {gitStatus.counts?.total} change{gitStatus.counts?.total === 1 ? '' : 's'}
                  </Badge>
                )}
              </div>
              <Button size="sm" variant="ghost" className="h-7" disabled={gitLoading || !activeProject} onClick={loadGitStatus}>
                {gitLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              </Button>
            </div>

            {!activeProject ? (
              <p className="text-xs text-muted-foreground">Open a project to see its git status.</p>
            ) : (
              <>
                <div className="flex gap-2">
                  <Input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder="Commit message (Update from Cloud Agent)" className="h-8 text-xs" />
                  <Button size="sm" className="h-8 shrink-0" disabled={gitLoading} onClick={gitCommit}>
                    <GitCommitHorizontal className="w-3.5 h-3.5 mr-1" />Commit
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={gitLoading} onClick={gitDiscard}>
                    Discard
                  </Button>
                </div>

                {gitStatus?.entries && gitStatus.entries.length > 0 && (
                  <div className="space-y-0.5 max-h-40 overflow-y-auto">
                    {gitStatus.entries.map((e, i) => (
                      <div key={`${e.path}-${i}`} className="flex items-center gap-2 text-xs p-1 rounded hover:bg-muted/40">
                        <Badge variant="outline" className="w-7 justify-center text-[10px] px-0 font-mono">
                          {e.x === '?' ? 'U' : (e.x + e.y).replace('?', '') || 'M'}
                        </Badge>
                        <span className="truncate font-mono text-[11px]">{e.origPath ? `${e.origPath} → ${e.path}` : e.path}</span>
                      </div>
                    ))}
                  </div>
                )}

                {gitStatus?.recent && gitStatus.recent.length > 0 && (
                  <div className="pt-1 border-t border-border">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                      <History className="w-3 h-3" /> recent commits
                    </p>
                    <div className="space-y-0.5 max-h-24 overflow-y-auto">
                      {gitStatus.recent.map((c, i) => (
                        <p key={i} className="text-[11px] font-mono text-muted-foreground truncate">{c}</p>
                      ))}
                    </div>
                  </div>
                )}

                {gitMsg && <p className="text-xs text-muted-foreground">{gitMsg}</p>}
                {gitStatus && !gitStatus.ok && <p className="text-xs text-destructive">{gitStatus.error || 'git status failed'}</p>}
                <p className="text-xs text-muted-foreground">
                  Local repository for this project. Push it to GitHub from the <b>Push</b> tab once connected.
                </p>
              </>
            )}
          </Card>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function PushForm({ onPush, busy }: { onPush: (repo: string) => void; busy: boolean }) {
  const [repo, setRepo] = useState('')
  return (
    <div className="flex gap-2">
      <Input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo-name" className="flex-1" />
      <Button size="sm" disabled={busy || !repo} onClick={() => onPush(repo)}>
        <Upload className="w-3.5 h-3.5 mr-1" />Push
      </Button>
    </div>
  )
}

// v71 — Pull & Sync form: merge-pull, reset-pull, and full sync buttons
function PullSyncForm({ busy, onPull, onSync }: { busy: boolean; onPull: (repo: string, mode: 'merge' | 'reset') => void; onSync: (repo: string) => void }) {
  const [repo, setRepo] = useState('')
  return (
    <div className="space-y-2">
      <Input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo-name" className="font-mono text-xs" />
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="flex-1" disabled={busy || !repo} onClick={() => onPull(repo, 'merge')}>
          <DownloadIcon className="w-3.5 h-3.5 mr-1" />Pull merge
        </Button>
        <Button size="sm" variant="outline" className="flex-1" disabled={busy || !repo} onClick={() => onPull(repo, 'reset')}>
          <DownloadIcon className="w-3.5 h-3.5 mr-1" />Pull reset
        </Button>
        <Button size="sm" className="flex-1" disabled={busy || !repo} onClick={() => onSync(repo)}>
          <RefreshCw className="w-3.5 h-3.5 mr-1" />Sync
        </Button>
      </div>
    </div>
  )
}
