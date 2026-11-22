'use client'

import { useEffect, useState, useRef } from 'react'
import { UserMenu } from '@/components/cloud-agent/UserMenu'
import {
  PanelLeftClose, PanelLeftOpen, Play, Square, Loader2, RefreshCw,
  Plus, Menu, ChevronLeft, Bot, Rocket, GitBranch, Settings as SettingsIcon,
  Terminal as TerminalIcon, Code2, Eye, PanelRightClose, PanelRightOpen,
  FolderOpen, Save, Download, Upload, FilePlus, FolderPlus, Search,
  Hammer, Activity, FileCode2, KeyRound, Zap, Folder, Monitor, Sparkles, Network, History,
  BookOpen, HelpCircle, HardDrive, Store, Users, Smartphone,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { toast } from 'sonner'
import { readApi } from '@/lib/http'
import { useAppStore, type ProjectMeta } from '@/lib/store'
import { useCollabStore } from '@/lib/collab-store'
import { CollabPresence } from '@/components/cloud-agent/dialogs/CollabDialog'
import { VersionHistoryDialog } from '@/components/cloud-agent/dialogs/VersionHistoryDialog'
import { SdkManagerDialog } from '@/components/cloud-agent/dialogs/SdkManagerDialog'
import { NotificationCenter } from './NotificationCenter'
import { FileTree } from './FileTree'
import { CodeEditor } from './CodeEditor'
import { LivePreview } from './LivePreview'
import { AgentPanel } from './AgentPanel'
import { TerminalPanel } from './TerminalPanel'

interface DashboardProps {
  project: ProjectMeta
}

export function Dashboard({ project }: DashboardProps) {
  const {
    closeProject, setProviderManagerOpen, setPublishDialogOpen, setExportDialogOpen, setGithubPanelOpen,
    setSettingsOpen, aiAgentOpen, setAIAgentOpen, terminalOpen, setTerminalOpen,
    treeVersion, setSecretsOpen, setDeveloperModeOpen, setMultiAgentOpen, setGrowthStudioOpen,
    setVersionHistoryOpen, setPromptLibraryOpen, setHelpOpen, setSdkManagerOpen,
    setMarketOpen, setCollabOpen,
  } = useAppStore()
  const online = useCollabStore((s) => s.online)
  const [apkBusy, setApkBusy] = useState(false)
  // Reactive dirty count for the Save All badge (the old inline getState()
  // call rendered a stale number that never updated)
  const dirtyCount = useAppStore(s => s.openTabs.filter(t => t.dirty).length)

  const [current, setCurrent] = useState<ProjectMeta>(project)
  const [status, setStatus] = useState(project.status || 'stopped')
  const [port, setPort] = useState<number | null>(project.entryPort || null)
  const [logs, setLogs] = useState('')
  const [activeProvider, setActiveProvider] = useState<{ id: string; name: string; model: string } | null>(null)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [bottomView, setBottomView] = useState<'agent' | 'terminal'>('agent')
  const [mobilePanel, setMobilePanel] = useState<'files' | 'editor' | 'preview' | 'agent' | 'terminal'>('editor')
  const [menuOpen, setMenuOpen] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)

  // Track whether we're on a large screen. The mobile panel block used to be
  // merely CSS-hidden on desktop (lg:hidden) but still MOUNTED — duplicating
  // every editor/preview/terminal instance and splitting terminal output
  // between the visible and hidden panes. Conditionally mounting fixes that.
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const apply = () => setIsDesktop(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  // Refresh project status periodically while running
  // v94 SPEED FIX: the old poller fetched the HEAVY /api/projects/<id> (full
  // listTree walk + detectFramework + DB) every 3 seconds FOREVER — even when
  // the project was stopped — and fed setCurrent(d2.project) each tick, whose
  // new object identity re-rendered the whole dashboard on the phone. Now the
  // poller only calls the light /api/runtime endpoint; project meta is loaded
  // once on open and once more when the runtime flips stopped→running
  // (that's when entryPort first appears). Idle polling relaxes to 10s.
  async function refreshStatus(): Promise<string | undefined> {
    try {
      const res = await fetch(`/api/runtime?projectId=${current.id}`)
      const data = await readApi<any>(res)
      // /api/runtime is the AUTHORITATIVE status source (it owns the
      // process map). The meta call below must never override it.
      if (data.status) setStatus(data.status)
      if (data.logs) setLogs(data.logs)
      const st: string | undefined = data.status || undefined
      if (st && st === 'running' && lastStatusRef.current !== 'running') loadProjectMeta()
      lastStatusRef.current = st || null
      return st
    } catch {}
  }

  async function loadProjectMeta(touch = false) {
    try {
      const r2 = await fetch(`/api/projects/${current.id}${touch ? '?touch=1' : ''}`)
      const d2 = await r2.json()
      if (d2.project) {
        setCurrent(d2.project)
        setPort(d2.project.entryPort || null)
        // Only fall back to the DB status when runtime gave us nothing
        if (!lastStatusRef.current) setStatus(d2.project.status || 'stopped')
      }
    } catch {}
  }

  const lastStatusRef = useRef<string | null>(null)

  useEffect(() => {
    lastStatusRef.current = null
    loadProjectMeta(true)
    refreshStatus()
    let t: ReturnType<typeof setTimeout>
    const tick = async () => {
      await refreshStatus()
      const delay = lastStatusRef.current === 'running' ? 3000 : 10000
      t = setTimeout(tick, delay)
    }
    t = setTimeout(tick, 3000)
    return () => clearTimeout(t)
  }, [current.id])

  // Load default provider info
  useEffect(() => {
    fetch('/api/providers').then(r => r.json()).then(data => {
      const def = data.providers?.find((p: any) => p.isDefault) || data.providers?.[0]
      if (def) setActiveProvider({ id: def.id, name: def.name, model: def.model })
    }).catch(() => {})
  }, [])

  // v63: the aiAgentOpen/terminalOpen flags were WRITE-ONLY for years —
  // the Command Palette's "Open AI agent chat", the sheet menu's Terminal
  // entry and the Prompt Library all set them, and nothing listened. Now a
  // flip on mobile lands on the matching bottom-nav panel too. Only reacts
  // to CHANGES (aiAgentOpen boots as true — the effect must not yank the
  // mobile view away from the editor on every mount).
  const prevAgentOpen = useRef(aiAgentOpen)
  const prevTerminalOpen = useRef(terminalOpen)
  useEffect(() => {
    if (isDesktop) return
    if (aiAgentOpen && !prevAgentOpen.current) setMobilePanel('agent')
    prevAgentOpen.current = aiAgentOpen
  }, [aiAgentOpen, isDesktop])
  useEffect(() => {
    if (isDesktop) return
    if (terminalOpen && !prevTerminalOpen.current) setMobilePanel('terminal')
    prevTerminalOpen.current = terminalOpen
  }, [terminalOpen, isDesktop])

  // v63: Ctrl+Shift+S — the Save All tooltip advertised this shortcut for
  // versions and NO keydown handler existed anywhere. Global, so it works
  // even while the editor/preview/terminal has focus (Monaco only owns Ctrl+S).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'S' || e.key === 's')) {
        e.preventDefault()
        void saveAll()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function saveAll() {
    const state = useAppStore.getState()
    const dirtyTabs = state.openTabs.filter(t => t.dirty)
    if (dirtyTabs.length === 0) {
      toast.info('No unsaved files')
      return
    }
    try {
      const results = await Promise.all(
        dirtyTabs.map(async (tab) => {
          try {
            const res = await fetch('/api/files', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                projectId: state.activeProject?.id,
                path: tab.path,
                content: tab.content,
              }),
            })
            return { path: tab.path, ok: res.ok }
          } catch (e: any) {
            return { path: tab.path, ok: false, error: e.message }
          }
        })
      )
      const saved = results.filter(r => r.ok).length
      const failed = results.filter(r => !r.ok).length
      if (saved > 0) useAppStore.getState().markAllSaved()
      if (failed === 0) {
        toast.success(`Saved all ${saved} file${saved !== 1 ? 's' : ''}`)
      } else {
        toast.error(`Saved ${saved}, failed ${failed}`)
      }
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  async function startProject() {
    setStatus('building')
    try {
      const res = await fetch('/api/runtime', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: current.id, action: 'start' }),
      })
      const data = await readApi<any>(res)
      if (data.ok) {
        setStatus('running')
        setPort(data.port)
        toast.success(`Running on port ${data.port}`)
      } else {
        setStatus('failed')
        toast.error(data.error || 'Failed to start')
      }
    } catch (e: any) {
      setStatus('failed')
      toast.error(e.message)
    }
  }

  async function stopProject() {
    try {
      await fetch('/api/runtime', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: current.id, action: 'stop' }),
      })
      setStatus('stopped')
      toast.success('Project stopped')
    } catch (e: any) { toast.error(e.message) }
  }

  async function installDeps() {
    if (installing) return
    setInstalling(true)
    toast.info('Installing dependencies — see terminal for output')
    setTerminalOpen(true); setBottomView('terminal')
    try {
      const res = await fetch('/api/runtime', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: current.id, action: 'exec', command: 'npm install 2>&1 || true', timeoutMs: 1200000 }),
      })
      const data = await readApi<any>(res)
      if (data.code === 0) toast.success('Dependencies installed')
      else toast.error('npm install failed — check the project type')
    } catch (e: any) { toast.error(e.message) }
    finally { setInstalling(false) }
  }

  async function exportZip() {
    const a = document.createElement('a')
    a.href = `/api/zip?projectId=${current.id}`
    a.download = `${current.name.replace(/[^a-z0-9]+/gi, '-')}.zip`
    a.click()
  }

  // v123 — ONE-CLICK ANDROID APK: build (real Flutter toolchain) then
  // auto-download. Flutter na thakle honest message + Export dialog hint.
  async function downloadApk() {
    if (apkBusy) return
    setApkBusy(true)
    const tid = toast.loading('APK build cholche — Flutter toolchain kaj korche (3-8 min lete pare)…', { duration: Infinity })
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: current.id, target: 'apk' }),
      })
      const data = await readApi<any>(res)
      if (data?.ok && data?.downloadUrl) {
        toast.success('APK toiri! Download shuru hocche…', { id: tid, duration: 6000 })
        const a = document.createElement('a')
        a.href = data.downloadUrl
        a.download = `${current.name.replace(/[^a-z0-9]+/gi, '-')}.apk`
        a.click()
      } else if ((data?.error || '').toLowerCase().includes('flutter')) {
        toast.error('APK hobe Flutter app theke. AI Agent ke bolen: "ei app ke Flutter e port koro" — tarpor ei button abar chapan.', { id: tid, duration: 9000 })
      } else {
        toast.error((data?.error || 'APK build failed').slice(0, 220) + ' — Export dialog e full log.', { id: tid, duration: 9000 })
      }
    } catch {
      toast.error('APK build request failed — network check korun.', { id: tid, duration: 6000 })
    }
    setApkBusy(false)
  }

  async function importZip() {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.zip'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const fd = new FormData()
      fd.append('file', file); fd.append('projectId', current.id)
      const res = await fetch('/api/zip', { method: 'POST', body: fd })
      const data = await readApi<any>(res)
      if (data.ok) {
        toast.success(`Imported ${data.imported} files`)
        useAppStore.getState().bumpTree()
      } else toast.error(data.error || 'Import failed')
    }
    input.click()
  }

  const statusColor: Record<string, string> = {
    running: 'ca-bg-running ca-status-running',
    building: 'ca-bg-building ca-status-building',
    failed: 'ca-bg-failed ca-status-failed',
    stopped: 'bg-muted text-muted-foreground',
  }

  return (
    <div
      className="flex flex-col bg-background text-foreground overflow-hidden"
      style={{ height: '100dvh', minHeight: '100dvh', maxHeight: '100dvh' }}
    >
      {/* Top nav */}
      <header className="h-12 border-b border-border flex items-center px-2 sm:px-3 gap-1 sm:gap-2 bg-card/30 shrink-0" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <Button variant="ghost" size="sm" onClick={closeProject}>
          <ChevronLeft className="w-4 h-4 mr-1" />
          <span className="hidden sm:inline">Back</span>
        </Button>

        <div className="flex items-center gap-2 px-2">
          <div className="w-7 h-7 rounded-md bg-primary/10 border border-primary/30 grid place-items-center">
            <svg viewBox="0 0 64 64" className="w-4 h-4">
              <path d="M14 22 L32 12 L50 22 L50 42 L32 52 L14 42 Z" stroke="currentColor" strokeWidth="3" fill="none" className="text-primary"/>
              <circle cx="32" cy="32" r="6" fill="currentColor" className="text-accent"/>
            </svg>
          </div>
          <span className="font-bold text-sm tracking-tight hidden sm:inline">CLOUD AGENT</span>
        </div>

        <div className="h-5 w-px bg-border mx-1 hidden sm:block" />

        <div className="flex items-center gap-1.5 min-w-0">
          <FileCode2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate max-w-[180px] sm:max-w-[280px]">{current.name}</span>
          <Badge variant="outline" className={`text-[10px] py-0 h-4 capitalize ${statusColor[status] || statusColor.stopped}`}>
            {status}
          </Badge>
          {port && (
            <Badge variant="outline" className="text-[10px] py-0 h-4 hidden sm:inline-flex">:{port}</Badge>
          )}
          <Badge variant="outline" className="text-[10px] py-0 h-4 hidden md:inline-flex bg-accent/10 text-accent border-accent/30" title="Secrets, Terminal, GitHub, and Files are isolated to THIS project. Each project has its own settings.">
            <FolderOpen className="w-2.5 h-2.5 mr-1" />isolated
          </Badge>
        </div>

        <div className="flex-1" />

        {/* Run controls */}
        <div className="flex items-center gap-1">
          {status !== 'running' && status !== 'building' ? (
            <Button size="sm" onClick={startProject} disabled={status === 'building'}>
              <Play className="w-3.5 h-3.5 mr-1" />
              <span className="hidden sm:inline">Run</span>
            </Button>
          ) : (
            <Button size="sm" variant="destructive" onClick={stopProject} disabled={status === 'building'}>
              {status === 'building' ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Square className="w-3.5 h-3.5 mr-1" />}
              {status === 'building' ? '…' : <span className="hidden sm:inline">Stop</span>}
            </Button>
          )}

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 hidden sm:inline-flex" onClick={installDeps} disabled={installing} title="Install deps">
                  {installing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{installing ? 'Installing… (up to 20 min)' : 'Install dependencies'}</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Button variant="ghost" size="icon" className="h-8 w-8 sm:hidden" onClick={() => setProviderManagerOpen(true)} title="AI providers">
            <Bot className="w-4 h-4" />
          </Button>

          <Button variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={() => setProviderManagerOpen(true)} title="AI providers">
            <Bot className="w-4 h-4 mr-1" />
            <span className="hidden md:inline">+AI</span>
          </Button>

          {/* AI Army — multi-agent swarm launcher */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="hidden sm:inline-flex text-accent" onClick={() => setMultiAgentOpen(true)} title="AI Army — multi-agent swarm">
                  <Network className="w-4 h-4 mr-1" />
                  <span className="hidden md:inline">AI Army</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Launch thousands of AI agents together</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button variant="ghost" size="icon" className="h-8 w-8 sm:hidden" onClick={() => setMultiAgentOpen(true)} title="AI Army">
            <Network className="w-4 h-4" />
          </Button>

          {/* Save All button — saves all dirty open tabs at once */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="hidden md:inline-flex"
                  onClick={saveAll}
                  title="Save all open files"
                >
                  <Save className="w-4 h-4 mr-1" />
                  <span className="hidden lg:inline">Save All</span>
                  {dirtyCount > 0 && <Badge variant="outline" className="ml-1 text-[10px] h-4 px-1">{dirtyCount}</Badge>}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Save all open files (Ctrl+Shift+S)</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 hidden md:inline-flex" onClick={() => setVersionHistoryOpen(true)} title="Version history">
                  <History className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Version history — snapshot & restore files</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* v63: the runtime `logs` string was polled from /api/runtime every
              3 seconds and then shown NOWHERE — a real data path to a dead
              end. A server-logs popover finally renders it. */}
          <Popover open={logsOpen} onOpenChange={setLogsOpen}>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 hidden md:inline-flex" title="Server / runtime logs">
                      <Hammer className="w-4 h-4" />
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>Server / runtime logs (live tail)</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <PopoverContent align="end" className="w-[420px] p-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 pb-1 flex items-center justify-between">
                <span>Runtime logs — /api/runtime tail</span>
                <button className="text-primary hover:underline normal-case" onClick={() => { logs ? navigator.clipboard?.writeText(logs) : toast.info('No logs yet') }}>copy</button>
              </div>
              <pre className="text-[10px] font-mono whitespace-pre-wrap max-h-72 overflow-y-auto bg-muted/40 rounded p-2">{logs || '(no runtime output yet — press Run/Stop to produce some)'}</pre>
            </PopoverContent>
          </Popover>

          {/* v60: run notification center — visible on ALL screen sizes now
              (the old mobile-hidden wrapper left phones without any bell) */}
          <UserMenu />
          <NotificationCenter />

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 hidden md:inline-flex" onClick={() => setSecretsOpen(true)} title="Secrets">
                  <KeyRound className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Secrets & API keys</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 hidden md:inline-flex" onClick={() => setDeveloperModeOpen(true)} title="Developer mode">
                  <Zap className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Developer mode</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* v79: SDK Manager — toolchain status + custom SDK binary install */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 hidden sm:inline-flex" onClick={() => setSdkManagerOpen(true)} title="SDK Manager">
                  <HardDrive className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>SDK Manager — toolchains, storage, custom SDK install</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button variant="ghost" size="icon" className="h-8 w-8 sm:hidden" onClick={() => setSdkManagerOpen(true)} title="SDK Manager">
            <HardDrive className="w-4 h-4" />
          </Button>

          <Button variant="ghost" size="sm" className="hidden md:inline-flex text-accent" onClick={() => setGrowthStudioOpen(true)} title="Growth Studio — monetize, analytics, PWA, security, versions">
            <Sparkles className="w-4 h-4 mr-1" /> Studio
          </Button>
          {/* v123 — collaboration avatar stack */}
          {online.length > 0 && (
            <button onClick={() => setCollabOpen(true)} className="hidden md:flex items-center -space-x-1.5 mr-1" title={`${online.length} online — collaborate`}>
              {online.slice(0, 4).map((p) => (
                <span key={p.userId} className="w-5 h-5 rounded-full border-2 border-background text-[9px] font-bold text-white flex items-center justify-center" style={{ background: p.color }}>
                  {(p.name || '?').slice(0, 1).toUpperCase()}
                </span>
              ))}
              {online.length > 4 && <span className="w-5 h-5 rounded-full border-2 border-background bg-muted text-[9px] flex items-center justify-center">+{online.length - 4}</span>}
            </button>
          )}
          <Button variant="ghost" size="sm" className="hidden md:inline-flex" onClick={() => setCollabOpen(true)} title="Collaborate — invite, live edits">
            <Users className="w-4 h-4 mr-1" />
            <span className="hidden lg:inline">Collab</span>
          </Button>
          <Button variant="ghost" size="sm" className="hidden md:inline-flex" onClick={() => setMarketOpen(true)} title="Marketplace — share/sell your apps">
            <Store className="w-4 h-4 mr-1" />
            <span className="hidden lg:inline">Market</span>
          </Button>
          <Button variant="ghost" size="sm" className="hidden md:inline-flex" onClick={downloadApk} disabled={apkBusy} title="Download Android APK (one-click build)">
            {apkBusy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Smartphone className="w-4 h-4 mr-1" />}
            <span className="hidden lg:inline">APK</span>
          </Button>
          <Button variant="ghost" size="sm" className="hidden md:inline-flex" onClick={() => setPublishDialogOpen(true)} title="Publish">
            <Rocket className="w-4 h-4 mr-1" />
            <span className="hidden lg:inline">Publish</span>
          </Button>
          <Button variant="ghost" size="sm" className="hidden md:inline-flex" onClick={() => setExportDialogOpen(true)} title="Export & Download — ZIP / APK / EXE">
            <Download className="w-4 h-4 mr-1" />
            <span className="hidden lg:inline">Export</span>
          </Button>

          {/* Hamburger menu — opens a bottom sheet on mobile, dropdown on desktop */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setMenuOpen(true)}
            title="Menu"
          >
            <Menu className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* Menu Sheet — slide-out panel with all project actions.
          Replaces the old dropdown menu which didn't work reliably on mobile. */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="right" className="w-full sm:max-w-sm overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Menu className="w-5 h-5" /> Menu
            </SheetTitle>
            <SheetDescription>{current.name}</SheetDescription>
          </SheetHeader>

          <div className="space-y-1 mt-4">
            {/* Tools section */}
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-1">Tools</p>
            <MenuButton icon={TerminalIcon} label="Terminal" onClick={() => { setTerminalOpen(true); setBottomView('terminal'); setMobilePanel('terminal'); setMenuOpen(false) }} />
            <MenuButton icon={FileCode2} label="Server logs" onClick={() => { setLogsOpen(true); setMenuOpen(false) }} />
            <MenuButton icon={GitBranch} label="GitHub" onClick={() => { setGithubPanelOpen(true); setMenuOpen(false) }} />
            <MenuButton icon={Users} label="Collaborate (live co-editing)" onClick={() => { setCollabOpen(true); setMenuOpen(false) }} />
            <MenuButton icon={Store} label="Marketplace (share / sell apps)" onClick={() => { setMarketOpen(true); setMenuOpen(false) }} />
            <MenuButton icon={Smartphone} label={apkBusy ? 'APK building…' : 'Download Android APK'} onClick={() => { setMenuOpen(false); downloadApk() }} />
            <MenuButton icon={History} label="Version history" onClick={() => { setVersionHistoryOpen(true); setMenuOpen(false) }} />
            <MenuButton icon={KeyRound} label="Secrets & API Keys" onClick={() => { setSecretsOpen(true); setMenuOpen(false) }} />
            <MenuButton icon={Zap} label="Developer Mode" onClick={() => { setDeveloperModeOpen(true); setMenuOpen(false) }} />
            <MenuButton icon={HardDrive} label="Add Storage / SDK" onClick={() => { setSdkManagerOpen(true); setMenuOpen(false) }} />
            <MenuButton icon={Bot} label="AI Providers" onClick={() => { setProviderManagerOpen(true); setMenuOpen(false) }} />
            <MenuButton icon={Network} label="AI Army (Multi-Agent)" onClick={() => { setMultiAgentOpen(true); setMenuOpen(false) }} />
            <MenuButton icon={Sparkles} label="Growth Studio" onClick={() => { setGrowthStudioOpen(true); setMenuOpen(false) }} />
            <MenuButton icon={Rocket} label="Publish" onClick={() => { setPublishDialogOpen(true); setMenuOpen(false) }} />
            <MenuButton icon={Download} label="Export / Download app (ZIP · APK · EXE)" onClick={() => { setExportDialogOpen(true); setMenuOpen(false) }} />
            <MenuButton icon={BookOpen} label="Prompt Library" onClick={() => { setPromptLibraryOpen(true); setMenuOpen(false) }} />
            <MenuButton icon={HelpCircle} label="Getting Started" onClick={() => { setHelpOpen(true); setMenuOpen(false) }} />

            {/* File section */}
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-1 mt-3">Files</p>
            <MenuButton icon={Download} label="Download ZIP" onClick={() => { exportZip(); setMenuOpen(false) }} />
            <MenuButton icon={Upload} label="Import ZIP" onClick={() => { importZip(); setMenuOpen(false) }} />

            {/* Project section */}
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-1 mt-3">Project</p>
            <MenuButton icon={SettingsIcon} label="Project Settings" onClick={() => { setSettingsOpen(true); setMenuOpen(false) }} />
            <MenuButton icon={Activity} label="Refresh Status" onClick={() => { refreshStatus(); setMenuOpen(false) }} />

            {/* Status info */}
            <div className="px-3 py-2 mt-3 bg-muted/30 rounded-lg">
              <p className="text-xs text-muted-foreground">Status: <span className={`ca-status-${status} font-medium`}>{status}</span></p>
              {port && <p className="text-xs text-muted-foreground">Port: <span className="font-mono">{port}</span></p>}
              <p className="text-xs text-muted-foreground">Framework: <span className="font-mono">{current.framework || 'unknown'}</span></p>
            </div>

            {/* Danger zone */}
            <p className="text-xs font-semibold uppercase tracking-wider text-destructive px-3 py-1 mt-3">Danger</p>
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-lg transition"
              onClick={() => {
                setMenuOpen(false)
                if (confirm(`Move project "${current.name}" to the Trash? You can restore it later.`)) {
                  fetch(`/api/projects/${current.id}`, { method: 'DELETE' })
                    .then(res => {
                      if (!res.ok) throw new Error(`HTTP ${res.status}`)
                      toast.success('Project moved to Trash')
                      closeProject()
                    })
                    .catch((e: any) => toast.error(e.message || 'Delete failed'))
                }
              }}
            >
              <Square className="w-3.5 h-3.5" />Move to Trash
            </button>
          </div>
        </SheetContent>
      </Sheet>

      {/* v60: editor time-travel — snapshot / restore every project file */}
      <VersionHistoryDialog />

      {/* v79: SDK Manager — storage + toolchains + custom binary install */}
      <SdkManagerDialog />

      {/* v123: collaboration heartbeat — presence + live file events */}
      <CollabPresence />

      {/* Main panel layout — desktop only (conditionally mounted so hidden
          duplicates never run behind the scenes) */}
      {isDesktop && (
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction="horizontal">
          {/* Left: file tree */}
          <ResizablePanel defaultSize={18} minSize={12} maxSize={30} collapsible>
            <FileTree projectId={current.id} />
          </ResizablePanel>
          <ResizableHandle withHandle />
          {/* Center: editor + bottom agent/terminal */}
          <ResizablePanel defaultSize={54} minSize={30}>
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel defaultSize={65} minSize={20}>
                <CodeEditor projectId={current.id} />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={35} minSize={10} maxSize={80}>
                <BottomPanel
                  projectId={current.id}
                  view={bottomView}
                  onView={setBottomView}
                  agentOpen={aiAgentOpen}
                  terminalOpen={terminalOpen}
                  onAgentToggle={() => { setAIAgentOpen(true); setTerminalOpen(false); setBottomView('agent') }}
                  onTerminalToggle={() => { setTerminalOpen(true); setAIAgentOpen(false); setBottomView('terminal') }}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle withHandle />
          {/* Right: preview */}
          <ResizablePanel defaultSize={28} minSize={15} maxSize={50}>
            <LivePreview projectId={current.id} port={port} status={status} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      )}

      {/* Mobile / tablet: all panels mounted, only one visible at a time.
          This preserves state (chat history, terminal sessions, open tabs)
          when the user switches between bottom-nav tabs. Only mounted on
          small screens — on desktop it used to stay mounted (display:none)
          duplicating editors/iframes and splitting terminal output. */}
      {!isDesktop && (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 relative overflow-hidden">
          {/* Each panel is always mounted; we toggle visibility via CSS so
              component state (chat messages, terminal session, scroll position)
              is preserved when switching tabs. */}
          <div className="absolute inset-0" style={{ display: mobilePanel === 'files' ? 'block' : 'none' }}>
            <FileTree projectId={current.id} />
          </div>
          <div className="absolute inset-0" style={{ display: mobilePanel === 'editor' ? 'block' : 'none' }}>
            <CodeEditor projectId={current.id} />
          </div>
          <div className="absolute inset-0" style={{ display: mobilePanel === 'preview' ? 'block' : 'none' }}>
            <LivePreview projectId={current.id} port={port} status={status} />
          </div>
          <div className="absolute inset-0" style={{ display: mobilePanel === 'agent' ? 'block' : 'none' }}>
            <AgentPanel projectId={current.id} providerId={activeProvider?.id} defaultModel={activeProvider?.model} fullHeight />
          </div>
          <div className="absolute inset-0" style={{ display: mobilePanel === 'terminal' ? 'block' : 'none' }}>
            <TerminalPanel projectId={current.id} />
          </div>
        </div>

        {/* Bottom navigation */}
        <nav className="shrink-0 border-t border-border bg-card/95 backdrop-blur flex items-center justify-around px-1 py-1.5" style={{ paddingBottom: 'max(0.375rem, env(safe-area-inset-bottom))' }}>
          <MobileTab active={mobilePanel === 'files'} onClick={() => setMobilePanel('files')} icon={Folder} label="Files" />
          <MobileTab active={mobilePanel === 'editor'} onClick={() => setMobilePanel('editor')} icon={Code2} label="Editor" />
          <MobileTab active={mobilePanel === 'agent'} onClick={() => setMobilePanel('agent')} icon={Bot} label="Agent" highlight={true} />
          <MobileTab active={mobilePanel === 'terminal'} onClick={() => setMobilePanel('terminal')} icon={TerminalIcon} label="Terminal" />
          <MobileTab active={mobilePanel === 'preview'} onClick={() => setMobilePanel('preview')} icon={Monitor} label="Preview" />
        </nav>
      </div>
      )}
    </div>
  )
}

function MobileTab({ active, onClick, icon: Icon, label, highlight }: {
  active: boolean
  onClick: () => void
  icon: any
  label: string
  highlight?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-lg min-w-[56px] transition ${
        active
          ? 'text-primary bg-primary/10'
          : highlight
            ? 'text-accent'
            : 'text-muted-foreground'
      }`}
    >
      <Icon className="w-5 h-5" />
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  )
}

/** Menu button used inside the slide-out menu sheet. */
function MenuButton({ icon: Icon, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return (
    <button
      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-foreground hover:bg-accent/20 rounded-lg transition min-h-[44px]"
      onClick={onClick}
    >
      <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
      <span className="font-medium">{label}</span>
    </button>
  )
}

function BottomPanel({ projectId, view, onView, agentOpen, terminalOpen, onAgentToggle, onTerminalToggle }: {
  projectId: string
  view: 'agent' | 'terminal'
  onView: (v: 'agent' | 'terminal') => void
  agentOpen: boolean
  terminalOpen: boolean
  onAgentToggle: () => void
  onTerminalToggle: () => void
}) {
  // v63: agentOpen/terminalOpen used to be destructured and dropped — the
  // Command Palette's "Open AI agent chat" flipped a flag nobody read.
  // They now steer which bottom panel is visible.
  useEffect(() => { if (agentOpen) onView('agent') }, [agentOpen])
  useEffect(() => { if (terminalOpen) onView('terminal') }, [terminalOpen])
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-card/30 shrink-0">
        <Button
          variant={view === 'agent' ? 'default' : 'ghost'}
          size="sm"
          className="h-7"
          onClick={() => { onAgentToggle(); onView('agent') }}
        >
          <Bot className="w-3.5 h-3.5 mr-1" />Cloud Agent
        </Button>
        <Button
          variant={view === 'terminal' ? 'default' : 'ghost'}
          size="sm"
          className="h-7"
          onClick={() => { onTerminalToggle(); onView('terminal') }}
        >
          <TerminalIcon className="w-3.5 h-3.5 mr-1" />Terminal
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        {/* Keep BOTH panels mounted — toggling used to unmount TerminalPanel
            whose cleanup killed the bash session every time the user peeked
            at the agent. CSS visibility preserves the session. */}
        <div className="h-full" style={{ display: view === 'agent' ? 'block' : 'none' }}>
          <AgentPanel projectId={projectId} />
        </div>
        <div className="h-full" style={{ display: view === 'terminal' ? 'block' : 'none' }}>
          <TerminalPanel projectId={projectId} />
        </div>
      </div>
    </div>
  )
}
