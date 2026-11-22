'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import {
  Plus,
  Clock,
  HardDrive,
  LayoutGrid,
  Globe,
  Play,
  MoreVertical,
  Trash2,
  Download,
  Upload,
  RefreshCw,
  KeyRound,
  Zap,
  Loader2,
  Copy,
  ImagePlus,
  Wand2,
  ChevronDown,
  Ban,
  Archive,
  ArchiveRestore,
  Activity,
  Folder,
  Pin,
  PinOff,
  HelpCircle,
  BookOpen,
  Pencil,
  Undo2,
  PartyPopper,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import dynamic from 'next/dynamic'
import { useAppStore, type ProjectMeta } from '@/lib/store'
import { ALL_TEMPLATES } from '@/lib/templates'
import { readApi } from '@/lib/http'
import { LANGUAGES } from '@/lib/languages'
import { bigBillionDayCopy, bigBillionDayState } from '@/lib/bbd'
// v114 — lazy: SDK manager + notification center only load when needed, keeping
// the welcome screen's critical JS small (buttons hydrate fast on phones)
const SdkManagerDialog = dynamic(
  () => import('@/components/cloud-agent/dialogs/SdkManagerDialog').then(m => ({ default: m.SdkManagerDialog })),
  { ssr: false }
)
const NotificationCenter = dynamic(
  () => import('@/components/cloud-agent/dashboard/NotificationCenter').then(m => ({ default: m.NotificationCenter })),
  { ssr: false }
)
import { UserMenu } from '@/components/cloud-agent/UserMenu'
import { AdminSecretEntry } from '@/components/cloud-agent/AdminSecretEntry'

const APP_TPLS = ALL_TEMPLATES.filter(t => t.id.startsWith('app-'))
// Language cards already cover most framework starters — keep the rest here
// so the Electron desktop starter and every app template stay reachable.
const LANG_TEMPLATE_IDS = new Set(LANGUAGES.map(l => l.templateId).filter(Boolean) as string[])
const FW_TPLS = ALL_TEMPLATES.filter(t => !t.id.startsWith('app-') && !LANG_TEMPLATE_IDS.has(t.id))

type IconMode = 'none' | 'upload' | 'ai'

export function WelcomeView() {
  // v63: removed unused `useRouter()`/`router` and `setView` destructures
  const { openProject, setSecretsOpen, setDeveloperModeOpen, setProviderManagerOpen, setSettingsOpen, setPromptLibraryOpen, setHelpOpen, setSdkManagerOpen } = useAppStore()
  const [projects, setProjects] = useState<ProjectMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'recent' | 'all'>('recent')
  // v55: archived projects stay out of sight until explicitly requested
  const [showArchived, setShowArchived] = useState(false)
  // v62: trash (soft-deleted projects, restorable until deleted forever)
  const [showTrash, setShowTrash] = useState(false)
  const [trashProjects, setTrashProjects] = useState<ProjectMeta[]>([])
  // v62: rename / edit metadata dialog
  const [renaming, setRenaming] = useState<ProjectMeta | null>(null)
  const [renameName, setRenameName] = useState('')
  const [renameDesc, setRenameDesc] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  // '__tpl:<id>' = advanced template pick (e.g. Electron); otherwise a language id
  const [newLang, setNewLang] = useState('html')
  const [iconMode, setIconMode] = useState<IconMode>('none')
  const [iconDataUrl, setIconDataUrl] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const iconFileRef = useRef<HTMLInputElement>(null)
  // v60: home stats strip (all real data) + pinned projects
  const [stats, setStats] = useState<{ runs7d: number | null; tokens7d: number | null; cost7d: number | null; keysTotal: number | null; keysHealthy: number | null }>({ runs7d: null, tokens7d: null, cost7d: null, keysTotal: null, keysHealthy: null })
  const [pinned, setPinned] = useState<string[]>([])
  // v115 — Big Billion Day strip needs the viewer's plan/role
  const [me, setMe] = useState<{ role?: string; plan?: string } | null>(null)

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => setMe(d?.user ? { role: d.user.role, plan: d.user.plan } : null))
      .catch(() => setMe(null))
  }, [])

  useEffect(() => {
    try { setPinned(JSON.parse(localStorage.getItem('ca:pinned') || '[]')) } catch { setPinned([]) }
    ;(async () => {
      try {
        const since = Date.now() - 7 * 86_400_000
        const [runsR, usageR, healthR] = await Promise.all([
          fetch('/api/runs?limit=200', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
          fetch('/api/usage?days=7', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
          fetch('/api/providers/health', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
        ])
        const runs7d = Array.isArray(runsR?.runs) ? runsR.runs.filter((r: any) => new Date(r.createdAt || 0).getTime() >= since).length : null
        const tokens7d = usageR?.totals ? (usageR.totals.tokensIn || 0) + (usageR.totals.tokensOut || 0) : null
        const cost7d = typeof usageR?.totalCostUSD === 'number' ? usageR.totalCostUSD : null
        const keysTotal = healthR && Array.isArray(healthR.providers) ? healthR.providers.length : null
        const keysHealthy = healthR && Array.isArray(healthR.providers) ? healthR.providers.filter((k: any) => k.status === 'healthy').length : null
        setStats({ runs7d, tokens7d, cost7d, keysTotal, keysHealthy })
      } catch { /* strip stays honest (null = unknown) */ }
    })()
  }, [])

  function togglePin(id: string) {
    setPinned(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      try { localStorage.setItem('ca:pinned', JSON.stringify(next)) } catch {}
      return next
    })
  }

  async function loadProjects() {
    setLoading(true)
    try {
      const res = await fetch('/api/projects')
      const data = await readApi<{ projects?: ProjectMeta[] }>(res)
      setProjects(data.projects || [])
    } catch (e: any) {
      toast.error(e.message || 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }

  // v62: the trash bin is a separate list (soft-deleted projects)
  const loadTrash = useCallback(async () => {
    try {
      const res = await fetch('/api/projects?trash=1', { cache: 'no-store' })
      const data = await readApi<{ projects?: ProjectMeta[] }>(res)
      setTrashProjects(data.projects || [])
    } catch { setTrashProjects([]) }
  }, [])

  useEffect(() => {
    if (showTrash) loadTrash()
  }, [showTrash, loadTrash])

  // v137 FIX: the Trash button was gated on trashCount > 0, but trashProjects
  // only loaded when showTrash was already true — and the button that sets
  // showTrash was hidden because the count was 0. Catch-22: a user who
  // trashed a project could NEVER see the Trash button again, so "restore
  // later" was impossible. The trash list now loads once on mount too.
  useEffect(() => { loadTrash() }, [loadTrash])

  useEffect(() => { loadProjects() }, [])

  async function createProject() {
    if (!newName.trim() || creating) {
      if (!newName.trim()) toast.error('Project name required')
      return
    }
    setCreating(true)
    try {
      const isAdvancedTpl = newLang.startsWith('__tpl:')
      const payload: Record<string, unknown> = { name: newName, description: newDesc }
      if (isAdvancedTpl) {
        payload.templateId = newLang.slice('__tpl:'.length)
      } else {
        payload.language = newLang
      }
      if (!isAdvancedTpl && iconMode === 'upload' && iconDataUrl) payload.iconDataUrl = iconDataUrl
      if (!isAdvancedTpl && iconMode === 'ai') payload.aiIcon = true
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      // v114b — readApi: a gateway 502/504 HTML page during server load used to
      // surface as the cryptic "Unexpected token '<'" — now it's an honest message
      const data = await readApi<any>(res)
      if (data.project) {
        const iconNote = data.iconError ? ` (icon failed: ${data.iconError})` : data.icon ? ` — ${data.icon.source === 'ai' ? 'AI icon generated' : 'icon uploaded'}` : ''
        toast.success(`Created "${data.project.name}" — ${data.written || 0} starter files${iconNote}`)
        setCreateOpen(false)
        setNewName(''); setNewDesc(''); setIconMode('none'); setIconDataUrl('')
        openProject(data.project)
      } else {
        toast.error(data.error || 'Create failed')
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setCreating(false)
    }
  }

  function onIconFile(f: File | undefined) {
    if (!f) return
    if (f.size > 4 * 1024 * 1024) {
      toast.error('Icon must be under 4 MB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setIconDataUrl(String(reader.result || ''))
      setIconMode('upload')
    }
    reader.readAsDataURL(f)
  }

  // v62: Delete is now a TRASH move (soft delete) — restorable until
  // "Delete forever". The old confirm text honestly says so.
  async function deleteProject(id: string) {
    if (!confirm('Move this project to the Trash? You can restore it later.')) return
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success('Project moved to Trash')
      loadProjects()
      loadTrash() // v137: always refresh the trash count — the button must appear right after trashing, not after a reload
    } catch (e: any) {
      toast.error(e.message || 'Delete failed')
    }
  }

  // v62: put a trashed project back
  async function restoreProject(p: ProjectMeta) {
    try {
      const res = await fetch(`/api/projects/${p.id}/restore`, { method: 'POST' })
      const data = await readApi<any>(res)
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`)
      toast.success(`"${p.name}" restored`)
      loadTrash()
      loadProjects()
    } catch (e: any) {
      toast.error(e.message || 'Restore failed')
    }
  }

  // v62: permanent delete from the trash (the old destructive path, ?hard=1)
  async function deleteForever(p: ProjectMeta) {
    if (!confirm(`Delete "${p.name}" FOREVER? Files, runs and history will be lost.`)) return
    try {
      const res = await fetch(`/api/projects/${p.id}?hard=1`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success('Deleted forever')
      loadTrash()
    } catch (e: any) {
      toast.error(e.message || 'Delete failed')
    }
  }

  // v62: rename / edit metadata (PATCH name + description — both whitelisted server-side)
  function openRename(p: ProjectMeta) {
    setRenaming(p)
    setRenameName(p.name)
    setRenameDesc(p.description || '')
  }

  async function submitRename() {
    if (!renaming) return
    const name = renameName.trim()
    if (!name) { toast.error('Name cannot be empty'); return }
    setRenameBusy(true)
    try {
      const res = await fetch(`/api/projects/${renaming.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: renameDesc.trim() || null }),
      })
      const data = await readApi<any>(res)
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      toast.success('Project updated')
      setRenaming(null)
      loadProjects()
    } catch (e: any) {
      toast.error(e.message || 'Rename failed')
    } finally { setRenameBusy(false) }
  }

  // v55: archive/unarchive — nothing is deleted, the project just leaves the
  // default lists until you ask for it again (Show archived toggle)
  async function archiveProject(p: ProjectMeta, archived: boolean) {
    try {
      const res = await fetch(`/api/projects/${p.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: archived ? 'archived' : 'stopped' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success(archived ? `"${p.name}" archived` : `"${p.name}" restored`)
      loadProjects()
    } catch (e: any) {
      toast.error(e.message || (archived ? 'Archive failed' : 'Restore failed'))
    }
  }

  async function runProject(p: ProjectMeta) {
    openProject(p)
    setTimeout(async () => {
      try {
        const res = await fetch('/api/runtime', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: p.id, action: 'start' }),
        })
        const data = await readApi<any>(res)
        if (data.ok) toast.success(`Running on port ${data.port}`)
        else toast.error(data.error || 'Failed to start')
      } catch (e: any) { toast.error(e.message) }
    }, 500)
  }

  async function exportZip(p: ProjectMeta) {
    const url = `/api/zip?projectId=${p.id}`
    const a = document.createElement('a')
    a.href = url
    a.download = `${p.name.replace(/[^a-z0-9]+/gi, '-')}.zip`
    a.click()
  }

  async function cloneProject(p: ProjectMeta) {
    const toastId = toast.loading(`Cloning "${p.name}"…`)
    try {
      const res = await fetch('/api/projects/clone', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: p.id }),
      })
      const data = await readApi<any>(res)
      if (data.ok) {
        toast.success(`Cloned as "${data.project.name}"`, { id: toastId })
        loadProjects()
      } else {
        toast.error(data.error || 'Clone failed', { id: toastId })
      }
    } catch (e: any) {
      toast.error(e.message || 'Clone failed', { id: toastId })
    }
  }

  async function importZip(file: File) {
    const name = file.name.replace(/\.zip$/i, '')
    // Create a project first
    try {
      const res = await fetch('/api/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await readApi<any>(res)
      if (!data.project) throw new Error(data.error || 'create failed')
      const fd = new FormData()
      fd.append('file', file)
      fd.append('projectId', data.project.id)
      const up = await fetch('/api/zip', { method: 'POST', body: fd })
      const upData = await readApi<any>(up)
      if (upData.ok) {
        toast.success(`Imported ${upData.imported} files`)
        openProject(data.project)
      } else {
        toast.error(upData.error || 'Import failed')
      }
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  // Deduplicate projects by ID (same project opening multiple times should
  // only appear once), then sort. Archived ones stay hidden by default.
  const deduped = projects.filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i)
  const visible = showArchived ? deduped : deduped.filter(p => p.status !== 'archived')
  const archivedCount = deduped.filter(p => p.status === 'archived').length
  const trashCount = trashProjects.length
  // v60: pinned projects always float to the top of every tab
  const pinRank = (p: ProjectMeta) => (pinned.includes(p.id) ? 0 : 1)
  const sorted = (tab === 'recent'
    ? [...visible].sort((a, b) => new Date(b.lastOpenedAt || 0).getTime() - new Date(a.lastOpenedAt || 0).getTime())
    : [...visible].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
  ).sort((a, b) => pinRank(a) - pinRank(b))

  return (
    <div className="h-[100dvh] bg-background text-foreground ca-grid-bg flex flex-col overflow-hidden">
      {/* Header — compact on mobile, full on desktop */}
      <header className="border-b border-border bg-card/40 backdrop-blur shrink-0 z-30" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2 sm:py-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg bg-primary/10 border border-primary/30 grid place-items-center">
              <svg viewBox="0 0 64 64" className="w-4 h-4 sm:w-6 sm:h-6">
                <path d="M14 22 L32 12 L50 22 L50 42 L32 52 L14 42 Z" stroke="currentColor" strokeWidth="2" fill="none" className="text-primary"/>
                <circle cx="32" cy="32" r="6" fill="currentColor" className="text-accent"/>
              </svg>
            </div>
            <div className="hidden xs:block sm:block">
              <h1 id="ca-brand-title" className="text-sm sm:text-lg font-bold tracking-tight cursor-default select-none">CLOUD AGENT</h1>
              <p className="text-[10px] sm:text-xs text-muted-foreground hidden sm:block">Personal AI Cloud App Builder</p>
            </div>
          </div>
          {/* Mobile: compact icon-only buttons. Desktop: full labels */}
          <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto">
            {/* v85: SDK Manager on the HOME screen too — the owner could not
                find the ☰ Menu (it only existed inside a project's Dashboard
                header) and reported "☰ e button tai nei". Same HardDrive
                button as the Dashboard header now. */}
            <Button variant="outline" size="sm" className="h-8 px-2 sm:px-3" onClick={() => setSdkManagerOpen(true)} title="Add Storage / SDK Manager">
              <HardDrive className="w-4 h-4 sm:mr-1.5" /><span className="hidden sm:inline">Add Storage / SDK</span>
            </Button>
            {/* v117 — the OWNER could not find the control room ("Admin
                dashboard/panel kothay"). Admin-role sessions get a visible
                shield button that opens the same PIN box; non-admins see
                nothing (panel stays secret, 5-tap trigger still works). */}
            {me?.role === 'admin' && <AdminSecretEntry targetId="ca-brand-title" isAdmin />}
            <UserMenu />
            <NotificationCenter />
            <Button variant="outline" size="sm" className="h-8 px-2 sm:px-3" onClick={() => setPromptLibraryOpen(true)} title="Prompt library">
              <BookOpen className="w-4 h-4 sm:mr-1.5" /><span className="hidden sm:inline">Library</span>
            </Button>
            <Button variant="outline" size="sm" className="h-8 px-2 sm:px-3" onClick={() => setHelpOpen(true)} title="Getting started">
              <HelpCircle className="w-4 h-4 sm:mr-1.5" /><span className="hidden sm:inline">Help</span>
            </Button>
            <Button variant="outline" size="sm" className="h-8 px-2 sm:px-3" onClick={() => setSecretsOpen(true)}>
              <KeyRound className="w-4 h-4 sm:mr-1.5" /><span className="hidden sm:inline">Secrets</span>
            </Button>
            <Button variant="outline" size="sm" className="h-8 px-2 sm:px-3" onClick={() => setDeveloperModeOpen(true)}>
              <Zap className="w-4 h-4 sm:mr-1.5" /><span className="hidden sm:inline">Dev Mode</span>
            </Button>
            <Button variant="outline" size="sm" className="h-8 px-2 sm:px-3" onClick={() => setProviderManagerOpen(true)}>
              +AI
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
              Settings
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="w-4 h-4 mr-1.5" /> Import ZIP
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="w-4 h-4 mr-1.5" /> Create New App
                </Button>
              </DialogTrigger>
            </Dialog>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto w-full px-3 sm:px-6 py-4 sm:py-8 flex-1 overflow-y-auto overscroll-contain" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 2rem)', WebkitOverflowScrolling: 'touch' }}>
        {/* v115 — Big Billion Day strip: honest clock for free users, live status when open */}
        {(() => {
          const isFree = !me?.plan || me.plan === 'free'
          if (!isFree || me?.role === 'admin') return null
          const bbd = bigBillionDayState()
          const copy = bigBillionDayCopy()
          return (
            <div className={`mb-4 rounded-xl border px-4 py-2.5 text-xs sm:text-sm flex flex-wrap items-center gap-2 ${bbd.active ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' : 'border-primary/30 bg-primary/5 text-muted-foreground'}`}>
              <PartyPopper className="w-4 h-4 shrink-0 text-primary" />
              <span className="flex-1 min-w-0">{copy}</span>
              {!bbd.active && (
                <a href="/pricing" className="underline underline-offset-4 hover:text-foreground shrink-0">See plans →</a>
              )}
            </div>
          )
        })()}
        {/* Hero — compact on mobile */}
        <section className="mb-4 sm:mb-10">
          <h2 className="text-xl sm:text-5xl font-bold tracking-tight mb-2 sm:mb-3">
            Build, run and ship software
            <br />
            <span className="text-primary">from one AI-native workspace.</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl text-xs sm:text-lg">
            Cloud Agent combines a Monaco editor, terminal, live preview and a real AI coding agent
            that can read files, edit code, install packages, run your project and fix errors — all
            from one unified interface.
          </p>
          <div className="mt-3 sm:mt-6 flex flex-wrap gap-2 sm:gap-3">
            <Button onClick={() => setCreateOpen(true)} size="sm" className="sm:size-lg">
              <Plus className="w-4 h-4 sm:w-5 sm:h-5 mr-1 sm:mr-2" /> Create New App
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)} size="sm" className="sm:size-lg">
              <Upload className="w-4 h-4 sm:w-5 sm:h-5 mr-1 sm:mr-2" /> Import ZIP
            </Button>
          </div>
        </section>

        {/* v60 — home stats strip: every number is real (DB-backed APIs) */}
        <div className="mb-4 sm:mb-6 grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Card className="p-2.5 sm:p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Folder className="w-3 h-3" /> Projects</div>
            <div className="text-lg sm:text-xl font-bold">{projects.length}</div>
          </Card>
          <Card className="p-2.5 sm:p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Activity className="w-3 h-3" /> Runs (7d)</div>
            <div className="text-lg sm:text-xl font-bold">{stats.runs7d === null ? '—' : stats.runs7d}</div>
          </Card>
          <Card className="p-2.5 sm:p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Zap className="w-3 h-3" /> Tokens (7d)</div>
            <div className="text-lg sm:text-xl font-bold">
              {stats.tokens7d === null ? '—' : stats.tokens7d >= 1_000_000 ? `${(stats.tokens7d / 1_000_000).toFixed(1)}M` : stats.tokens7d >= 1000 ? `${(stats.tokens7d / 1000).toFixed(1)}k` : stats.tokens7d}
              {stats.cost7d !== null && stats.cost7d > 0 && <span className="text-xs text-emerald-400 font-medium ml-1">≈ ${stats.cost7d.toFixed(2)}</span>}
            </div>
          </Card>
          <Card className="p-2.5 sm:p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><KeyRound className="w-3 h-3" /> Keys healthy</div>
            <div className="text-lg sm:text-xl font-bold">{stats.keysTotal === null ? '—' : `${stats.keysHealthy}/${stats.keysTotal}`}</div>
          </Card>
        </div>

        {/* Tabs */}
        <section data-marker="tabs-section-v137">
          <div className="flex items-center justify-between mb-3 sm:mb-4 gap-2">
            <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
              <TabsList className="h-8">
                <TabsTrigger value="recent" className="text-xs px-2"><Clock className="w-3.5 h-3.5 mr-1" />Recent</TabsTrigger>
                <TabsTrigger value="all" className="text-xs px-2"><LayoutGrid className="w-3.5 h-3.5 mr-1" />All</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="ghost" size="sm" onClick={loadProjects} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            {archivedCount > 0 && (
              <Button variant={showArchived ? 'secondary' : 'ghost'} size="sm" onClick={() => setShowArchived(s => !s)}>
                <Archive className="w-4 h-4 mr-1.5" />
                <span className="hidden sm:inline">{showArchived ? 'Hide archived' : 'Show archived'}</span>
                <span className="ml-1 text-[10px] opacity-70">{archivedCount}</span>
              </Button>
            )}
            {/* v137: the Trash button is ALWAYS visible — the old trashCount > 0
                gate never fired because the count only loaded after the button
                was clicked (catch-22), so a trashed project was unrecoverable
                from the UI. Clicking it when empty just says "Trash is empty". */}
            <Button variant={showTrash ? 'secondary' : 'ghost'} size="sm" onClick={() => { setShowTrash(s => !s); loadTrash() }} title="Soft-deleted projects — restorable">
              <Trash2 className="w-4 h-4 mr-1.5" />
              <span className="hidden sm:inline">{showTrash ? 'Hide trash' : 'Trash'}</span>
              {trashCount > 0 && <span className="ml-1 text-[10px] opacity-70">{trashCount}</span>}
            </Button>
          </div>

          {showTrash && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                <Trash2 className="w-3.5 h-3.5" />
                Trash — deleted projects keep their files until you remove them forever.
              </div>
              {trashProjects.length === 0 ? (
                <Card className="p-6 text-center text-xs text-muted-foreground">Trash is empty.</Card>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-4">
                  {trashProjects.map(p => (
                    <Card key={p.id} className="p-3 opacity-90">
                      <div className="flex items-center gap-2">
                        <ProjectThumb projectId={p.id} />
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold text-xs truncate">{p.name}</h3>
                          <p className="text-[10px] text-muted-foreground truncate">deleted {p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : ''}</p>
                        </div>
                      </div>
                      <div className="flex gap-1.5 mt-2.5">
                        <Button size="sm" variant="outline" className="flex-1 h-7 text-[10px]" onClick={() => restoreProject(p)}>
                          <Undo2 className="w-3 h-3 mr-1" />Restore
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1 h-7 text-[10px] text-destructive hover:text-destructive" onClick={() => deleteForever(p)}>
                          <Trash2 className="w-3 h-3 mr-1" />Delete forever
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {sorted.length === 0 && !loading ? (
            <Card className="p-12 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 grid place-items-center mb-4">
                <Plus className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-1">No projects yet</h3>
              <p className="text-sm text-muted-foreground mb-4">Create your first project to get started.</p>
              <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-1.5" />Create New App</Button>
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-4">
              {sorted.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  isPinned={pinned.includes(p.id)}
                  onTogglePin={() => togglePin(p.id)}
                  onOpen={() => openProject(p)}
                  onRun={() => runProject(p)}
                  onDelete={() => deleteProject(p.id)}
                  onExport={() => exportZip(p)}
                  onClone={() => cloneProject(p)}
                  onArchive={() => archiveProject(p, p.status !== 'archived')}
                  onRename={() => openRename(p)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New App</DialogTitle>
            <DialogDescription>Name it, add an icon (yours or AI-drawn), pick a language — the AI scaffolds the whole project for that stack.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="name">Project name</Label>
              <Input id="name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="my-awesome-app" className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="desc">Description (optional)</Label>
              <Textarea id="desc" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="What is this app about? The AI uses this to plan features and design your icon." className="mt-1.5" rows={2} />
            </div>

            {/* App icon — upload your own, or let the AI design one */}
            <div>
              <Label>App icon <span className="text-muted-foreground font-normal">(optional — your own logo, or AI designs one)</span></Label>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => { setIconMode('none'); setIconDataUrl('') }}
                  className={`px-3 py-2 rounded-lg border text-xs flex items-center gap-1.5 transition ${iconMode === 'none' ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
                >
                  <Ban className="w-3.5 h-3.5" /> None
                </button>
                <button
                  type="button"
                  onClick={() => iconFileRef.current?.click()}
                  className={`px-3 py-2 rounded-lg border text-xs flex items-center gap-1.5 transition ${iconMode === 'upload' ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
                >
                  <ImagePlus className="w-3.5 h-3.5" /> Upload my logo
                </button>
                <button
                  type="button"
                  onClick={() => { setIconMode('ai'); setIconDataUrl('') }}
                  className={`px-3 py-2 rounded-lg border text-xs flex items-center gap-1.5 transition ${iconMode === 'ai' ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
                >
                  <Wand2 className="w-3.5 h-3.5" /> AI designs it
                </button>
                <input ref={iconFileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => onIconFile(e.target.files?.[0])} />
                {iconMode === 'upload' && iconDataUrl && (
                  <img src={iconDataUrl} alt="icon preview" className="w-9 h-9 rounded-lg border border-border object-cover" />
                )}
              </div>
              {iconMode === 'ai' && (
                <p className="text-[11px] text-muted-foreground mt-1.5">✨ The AI will draw a unique icon from your app name + description (~10 s). You can replace it later anytime.</p>
              )}
              {iconMode === 'upload' && !iconDataUrl && (
                <p className="text-[11px] text-muted-foreground mt-1.5">Pick a png / jpg / webp image (up to 4 MB). It becomes the app icon + favicon automatically.</p>
              )}
            </div>

            {/* Language — picking one seeds the whole project for that stack */}
            <div>
              <Label>Language <span className="text-muted-foreground font-normal">(the AI sets up everything for your pick)</span></Label>
              <div className="grid grid-cols-2 gap-2 mt-1.5">
                {LANGUAGES.map(l => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setNewLang(l.id)}
                    className={`text-left p-3 rounded-lg border transition ${newLang === l.id ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
                  >
                    <div className="font-medium text-sm">{l.icon} {l.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{l.tagline}</div>
                    <div className="text-[10px] text-muted-foreground/70 mt-1">Runs: {l.runs}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Advanced starters — Electron + ready-made app templates */}
            <div>
              <button type="button" onClick={() => setAdvancedOpen(v => !v)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition">
                <ChevronDown className={`w-3.5 h-3.5 transition ${advancedOpen ? 'rotate-180' : ''}`} />
                Advanced starters ({APP_TPLS.length + FW_TPLS.length} more — ready-made apps, Electron desktop)
              </button>
              {advancedOpen && (
                <div className="mt-2 space-y-3">
                  <div>
                    <Label className="text-xs">Ready-made apps</Label>
                    <div className="grid grid-cols-2 gap-2 mt-1.5">
                      {APP_TPLS.map(t => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setNewLang(`__tpl:${t.id}`)}
                          className={`text-left p-3 rounded-lg border transition ${newLang === `__tpl:${t.id}` ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
                        >
                          <div className="font-medium text-sm">{t.icon} {t.name}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">More frameworks</Label>
                    <div className="grid grid-cols-2 gap-2 mt-1.5">
                      {FW_TPLS.map(t => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setNewLang(`__tpl:${t.id}`)}
                          className={`text-left p-3 rounded-lg border transition ${newLang === `__tpl:${t.id}` ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
                        >
                          <div className="font-medium text-sm">{t.name}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createProject} disabled={creating}>
              {creating ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Creating…</> : <><Plus className="w-4 h-4 mr-1.5" />Create</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* v62 — Rename / edit project metadata */}
      <Dialog open={!!renaming} onOpenChange={(o) => { if (!o) setRenaming(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="w-4 h-4 text-primary" /> Rename / Edit</DialogTitle>
            <DialogDescription>Change the project's name and description — the AI uses the description when planning work.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <Label htmlFor="rename-name">Project name</Label>
              <Input id="rename-name" value={renameName} onChange={(e) => setRenameName(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="rename-desc">Description (optional)</Label>
              <Textarea id="rename-desc" value={renameDesc} onChange={(e) => setRenameDesc(e.target.value)} rows={3} className="mt-1.5" placeholder="What is this app about?" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRenaming(null)}>Cancel</Button>
            <Button size="sm" disabled={renameBusy || !renameName.trim()} onClick={submitRename}>
              {renameBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import project ZIP</DialogTitle>
            <DialogDescription>Upload a ZIP file. We'll create a new project and extract its contents.</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              type="file"
              accept=".zip"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) {
                  importZip(f).then(() => setImportOpen(false))
                }
              }}
            />
            <p className="text-xs text-muted-foreground mt-2">Up to 1GB per ZIP — big files stream straight to disk. node_modules and .git folders are skipped on import.</p>
          </div>
        </DialogContent>
      </Dialog>

      {/* v85 — SDK Manager reachable from the HOME screen (mirrors Dashboard) */}
      <SdkManagerDialog />

      {/* v115 secret owner entry: 5 quick taps on the "CLOUD AGENT" title →
          password box → straight into the control room. The admin-role
          instance above is the SAME component mounted ONCE — here it renders
          nothing (no duplicate tap listeners). */}
      {me?.role !== 'admin' && <AdminSecretEntry targetId="ca-brand-title" />}
    </div>
  )
}

function ProjectThumb({ projectId }: { projectId: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return <Globe className="w-7 h-7 sm:w-10 sm:h-10 text-muted-foreground/40 group-hover:text-primary/60 transition" />
  }
  return (
    <img
      src={`/api/projects/${projectId}/icon`}
      alt=""
      className="w-10 h-10 sm:w-14 sm:h-14 rounded-xl object-cover shadow-sm group-hover:scale-105 transition"
      onError={() => setFailed(true)}
    />
  )
}

function ProjectCard({ project, isPinned, onTogglePin, onOpen, onRun, onDelete, onExport, onClone, onArchive, onRename }: {
  project: ProjectMeta
  isPinned: boolean
  onTogglePin: () => void
  onOpen: () => void
  onRun: () => void
  onDelete: () => void
  onExport: () => void
  onClone: () => void
  onArchive: () => void
  onRename: () => void
}) {
  const framework = project.framework || 'unknown'
  const frameworkColor: Record<string, string> = {
    next: 'bg-primary/20 text-primary border-primary/30',
    react: 'bg-primary/20 text-primary border-primary/30',
    vite: 'bg-accent/20 text-accent border-accent/30',
    node: 'bg-accent/20 text-accent border-accent/30',
    flutter: 'bg-accent/20 text-accent border-accent/30',
    python: 'bg-primary/20 text-primary border-primary/30',
    static: 'bg-muted text-muted-foreground border-border',
    unknown: 'bg-muted text-muted-foreground border-border',
  }
  const lastMod = project.lastOpenedAt ? new Date(project.lastOpenedAt).toLocaleString() : (project.createdAt ? new Date(project.createdAt).toLocaleString() : '')
  return (
    <Card className="p-0 overflow-hidden hover:border-primary/40 transition group">
      <div className="h-16 sm:h-24 bg-gradient-to-br from-primary/10 via-accent/10 to-transparent border-b border-border grid place-items-center">
        <ProjectThumb projectId={project.id} />
      </div>
      <div className="p-2 sm:p-3">
        <div className="flex items-start justify-between gap-1 sm:gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-xs sm:text-sm truncate">{project.name}</h3>
            <p className="text-[10px] sm:text-xs text-muted-foreground truncate hidden sm:block">{project.description || 'No description'}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6 sm:h-7 sm:w-7 shrink-0">
                <MoreVertical className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onOpen}>Open</DropdownMenuItem>
              <DropdownMenuItem onClick={onRun}>Run</DropdownMenuItem>
              <DropdownMenuItem onClick={onRename}><Pencil className="w-4 h-4 mr-2" />Rename / Edit</DropdownMenuItem>
              <DropdownMenuItem onClick={onTogglePin}>
                {isPinned
                  ? <><PinOff className="w-4 h-4 mr-2" />Unpin</>
                  : <><Pin className="w-4 h-4 mr-2" />Pin to top</>}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onExport}><Download className="w-4 h-4 mr-2" />Export ZIP</DropdownMenuItem>
              <DropdownMenuItem onClick={onClone}><Copy className="w-4 h-4 mr-2" />Clone</DropdownMenuItem>
              <DropdownMenuItem onClick={onArchive}>
                {project.status === 'archived'
                  ? <><ArchiveRestore className="w-4 h-4 mr-2" />Restore from archive</>
                  : <><Archive className="w-4 h-4 mr-2" />Archive</>}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={onDelete}><Trash2 className="w-4 h-4 mr-2" />Move to Trash</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center gap-1 sm:gap-2 mt-1.5 sm:mt-2 flex-wrap">
          <Badge variant="outline" className={`text-[9px] sm:text-[10px] capitalize ${frameworkColor[framework] || frameworkColor.unknown}`}>{framework}</Badge>
          {isPinned && (
            <Badge variant="outline" className="text-[9px] sm:text-[10px] bg-amber-500/10 text-amber-500 border-amber-500/30"><Pin className="w-2.5 h-2.5 mr-0.5" />pinned</Badge>
          )}
          {project.status === 'archived' && (
            <Badge variant="outline" className="text-[9px] sm:text-[10px] bg-muted text-muted-foreground border-border">🗄️ archived</Badge>
          )}
          {project.status && project.status !== 'stopped' && project.status !== 'archived' && (
            <Badge variant="outline" className={`text-[9px] sm:text-[10px] capitalize ca-bg-${project.status} ca-status-${project.status}`}>
              {project.status}
            </Badge>
          )}
        </div>
        <div className="text-[9px] sm:text-[10px] text-muted-foreground mt-1 sm:mt-2 truncate">{lastMod}</div>
        <div className="flex gap-1 sm:gap-2 mt-2 sm:mt-3">
          <Button size="sm" variant="outline" className="flex-1 h-7 sm:h-8 text-[10px] sm:text-xs" onClick={onOpen}>Open</Button>
          <Button size="sm" className="flex-1 h-7 sm:h-8 text-[10px] sm:text-xs" onClick={onRun}><Play className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-0.5 sm:mr-1" />Run</Button>
        </div>
      </div>
    </Card>
  )
}
